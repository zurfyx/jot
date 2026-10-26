import { buildEditorFromExtensions } from '@lexical/extension';
import { YCollabExtension } from '@lexical/y';
import { Awareness } from '@y/protocols/awareness';
import * as Y from '@y/y';
import {
  $createParagraphNode,
  $getRoot,
  $isElementNode,
  configExtension,
  defineExtension,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';

import { computeBlame } from '../blame/attribution';
import { writeEntry } from '../blame/registry';
import { jotEditorExtension } from '../extensions';
import { createInTabPeer } from '../peers/peer';
import { ANA, JOT_AI_DEMO } from './controller';
import { $agendaItem, $isEmptyNote, $lastText, $writeExample, EXAMPLE } from './content';
import { type DemoCast, DemoAborted, resetDemo, runDemo } from './script';

/** The note's blocks as `type: text`, list items and table rows flattened one level. */
function outline(editor: LexicalEditor): string[] {
  return editor.getEditorState().read(() => {
    const lines: string[] = [];
    const walk = (node: LexicalNode) => {
      const type = node.getType();
      if (type === 'list' || type === 'table') {
        for (const child of $isElementNode(node) ? node.getChildren() : []) {
          walk(child);
        }
        return;
      }
      if (type === 'tablerow' && $isElementNode(node)) {
        lines.push(
          `row: ${node
            .getChildren()
            .map((cell) => cell.getTextContent())
            .join(' | ')}`,
        );
        return;
      }
      lines.push(`${type}: ${node.getTextContent()}`);
    };
    for (const child of $getRoot().getChildren()) {
      walk(child);
    }
    return lines;
  });
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/** A page with the example's two demo collaborators, and "you" typing through the page's editor. */
function setup() {
  const doc = new Y.Doc();
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'test/page',
      dependencies: [jotEditorExtension, configExtension(YCollabExtension, { doc, synced: true })],
    }),
  );
  editor.update(() => $getRoot().clear().append($createParagraphNode()), { discrete: true });
  writeEntry(doc, doc.clientID, { personId: 'me', name: 'Me', color: 0, kind: 'person', seen: 1 });
  const awareness = new Awareness(doc);
  const host = { doc, awareness };
  const ana = createInTabPeer(host, ANA);
  const ai = createInTabPeer(host, JOT_AI_DEMO);
  const cast: DemoCast = {
    ana,
    ai,
    youType(text) {
      editor.update(
        () => {
          const item = $agendaItem(EXAMPLE.agendaItems[0]);
          const last = item === null ? null : $lastText(item);
          last?.spliceText(last.getTextContentSize(), 0, text, false);
        },
        { discrete: true },
      );
    },
  };
  cleanups.push(() => {
    ana.dispose();
    ai.dispose();
    awareness.destroy();
    editor.dispose();
    doc.destroy();
  });
  return { doc, editor, cast, awareness };
}

const SEEDED = [
  `heading: ${EXAMPLE.title}`,
  `paragraph: ${EXAMPLE.intro.join('')}`,
  'heading: Agenda',
  `paragraph: ${EXAMPLE.agendaSentence}`,
  'heading: To do',
  'listitem: Book the room',
  'listitem: Order lunch',
  'row: Who | Brings',
  'row: Gerard | Laptop',
];

const PLAYED = [
  `heading: ${EXAMPLE.title}`,
  `paragraph: ${EXAMPLE.intro.join('')}`,
  'heading: Agenda',
  'listitem: Morning: roadmap review with demos',
  'listitem: Afternoon: hack session',
  'heading: To do',
  'listitem: Book the room',
  'listitem: Order lunch',
  'listitem: Send the agenda',
  'row: Who | Brings',
  'row: Gerard | Laptop',
  'row: Ana | Snacks',
];

describe('the example note', () => {
  it('seeds the offsite plan as Ana', () => {
    const { editor, cast, doc } = setup();
    expect(editor.getEditorState().read($isEmptyNote)).toBe(true);
    cast.ana.edit(() => $writeExample('https://jot.rovira.sh/n/x'));
    expect(outline(editor)).toEqual(SEEDED);
    expect(editor.getEditorState().read($isEmptyNote)).toBe(false);
    const { shares } = computeBlame(doc);
    expect(shares.map(({ person }) => person.name)).toEqual(['Ana (demo)']);
  });

  it('plays the script: three authors in blame', async () => {
    const { editor, cast, doc } = setup();
    cast.ana.edit(() => $writeExample(null));
    await runDemo(cast, { instant: true });
    expect(outline(editor)).toEqual(PLAYED);

    const { shares, people } = computeBlame(doc);
    expect(new Set(shares.map(({ person }) => person.name))).toEqual(
      new Set(['Ana (demo)', 'jot AI (demo)', 'Me']),
    );
    expect(people.get('demo-ana')?.kind).toBe('demo');
    expect(people.get('demo-jot-ai')?.kind).toBe('demo');
    const chars = Object.fromEntries(shares.map(({ person, chars }) => [person.id, chars]));
    expect(chars.me).toBe(EXAMPLE.youType.trim().length + 1);
    // The binding keeps text the rewrite did not change ("Morning"), so jot
    // AI is credited with the rest of the list.
    expect(chars['demo-jot-ai']).toBeGreaterThanOrEqual(EXAMPLE.agendaItems[1].length);
    expect(chars['demo-jot-ai']).toBeLessThanOrEqual(EXAMPLE.agendaItems.join('').length);
  });

  it('replays: puts the demo parts back, and plays to the same end', async () => {
    const { editor, cast } = setup();
    cast.ana.edit(() => $writeExample(null));
    await runDemo(cast, { instant: true });
    resetDemo(cast);
    expect(outline(editor)).toEqual(SEEDED);
    await runDemo(cast, { instant: true });
    expect(outline(editor)).toEqual(PLAYED);
  });

  it('skips the steps whose part someone edited away', async () => {
    const { editor, cast } = setup();
    cast.ana.edit(() => $writeExample(null));
    editor.update(
      () => {
        // Someone deleted the table and rewrote the agenda.
        for (const child of $getRoot().getChildren()) {
          if (child.getType() === 'table') {
            child.remove();
          }
          if (child.getTextContent() === EXAMPLE.agendaSentence) {
            child.replace($createParagraphNode());
          }
        }
      },
      { discrete: true },
    );
    await runDemo(cast, { instant: true });
    const lines = outline(editor);
    expect(lines).toContain('listitem: Send the agenda');
    expect(lines.some((line) => line.startsWith('row:'))).toBe(false);
    expect(lines.some((line) => line.includes('roadmap'))).toBe(false);
  });

  it('stops when aborted', async () => {
    const { editor, cast } = setup();
    cast.ana.edit(() => $writeExample(null));
    const controller = new AbortController();
    const running = runDemo(cast, { signal: controller.signal });
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(DemoAborted);
    expect(outline(editor)).toEqual(SEEDED);
  });
});
