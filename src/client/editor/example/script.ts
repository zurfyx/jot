/**
 * The example's script (about 20 s): Ana adds a to-do and a table row, then
 * jot AI turns the agenda sentence into a bulleted list while "you" type in
 * it, and both go idle. Every edit is a real Yjs write by its author: Ana and
 * jot AI through their in-tab peers, "you" through the page's own editor.
 */
import { $getSelection, $isRangeSelection } from 'lexical';

import type { InTabPeer } from '../peers/peer';
import {
  $agendaList,
  $agendaSentence,
  $appendTableRow,
  $cellParagraph,
  $createAgendaList,
  $createAgendaSentence,
  $exampleTable,
  $tableRow,
  $todoItem,
  $todoList,
  EXAMPLE,
} from './content';

export interface DemoCast {
  ana: InTabPeer;
  ai: InTabPeer;
  /** Types `text` as "you", at the end of the first agenda item. */
  youType(text: string): void;
}

export interface DemoOptions {
  /** Each step's edits at once, with no pauses (reduced motion, tests). */
  instant?: boolean;
  /** Stops the script between two edits. */
  signal?: AbortSignal;
}

/** Milliseconds per character for Ana and jot AI, and for "you". */
const PEER_CHAR_MS = 130;
const YOU_CHAR_MS = 170;

export class DemoAborted extends Error {
  constructor() {
    super('The demo stopped');
  }
}

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DemoAborted());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DemoAborted());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function $insertAtSelection(text: string): void {
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    selection.insertText(text);
  }
}

/**
 * Runs the script. Steps whose part of the note is gone (someone edited it
 * away) are skipped. Rejects with DemoAborted when `signal` aborts.
 */
export async function runDemo(cast: DemoCast, options: DemoOptions = {}): Promise<void> {
  const { instant = false, signal } = options;
  const wait = (ms: number) => (instant ? Promise.resolve() : pause(ms, signal));
  const type = async (peer: InTabPeer, text: string) => {
    if (instant) {
      peer.edit(() => $insertAtSelection(text));
      return;
    }
    for (const char of text) {
      await wait(PEER_CHAR_MS);
      peer.edit(() => $insertAtSelection(char));
    }
  };
  const { ana, ai } = cast;

  // 1. Ana adds the to-do "Send the agenda".
  await wait(2200);
  let added = false;
  ana.edit(() => {
    const list = $todoList();
    if (list === null || $todoItem(EXAMPLE.anaTodo) !== null) {
      return;
    }
    const last = list.getLastChild();
    if (last !== null) {
      last.selectEnd();
    }
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      selection.insertParagraph();
      added = true;
    }
  });
  if (added) {
    await wait(700);
    await type(ana, EXAMPLE.anaTodo);
  }

  // 2. And a table row.
  await wait(2200);
  let rowAdded = false;
  ana.edit(() => {
    const table = $exampleTable();
    if (table === null || $tableRow(EXAMPLE.anaRow[0]) !== null) {
      return;
    }
    const row = $appendTableRow(table);
    $cellParagraph(row, 0)?.select();
    rowAdded = true;
  });
  if (rowAdded) {
    await wait(700);
    await type(ana, EXAMPLE.anaRow[0]);
    await wait(500);
    ana.edit(() => {
      const row = $tableRow(EXAMPLE.anaRow[0]);
      if (row !== null) {
        $cellParagraph(row, 1)?.select();
      }
    });
    await wait(300);
    await type(ana, EXAMPLE.anaRow[1]);
  }

  // 3. jot AI selects the agenda sentence, then rewrites it as a list.
  await wait(2400);
  let selected = false;
  ai.edit(() => {
    const sentence = $agendaSentence();
    if (sentence !== null) {
      sentence.select(0, sentence.getChildrenSize());
      selected = true;
    }
  });
  if (!selected) {
    return;
  }
  await wait(2200);
  let listed = false;
  ai.edit(() => {
    const sentence = $agendaSentence();
    if (sentence === null) {
      return;
    }
    const list = $createAgendaList(!instant);
    sentence.replace(list);
    list.getLastChild()?.selectEnd();
    listed = true;
  });
  if (!listed) {
    return;
  }

  // 4. jot AI writes the second item while "you" type in the first.
  const second = EXAMPLE.agendaItems[1];
  if (instant) {
    // The list came with both items (see $createAgendaList).
    cast.youType(EXAMPLE.youType);
    ai.edit(() => {
      $agendaList()?.getLastChild()?.selectEnd();
    });
    return;
  }
  await wait(700);
  const events: { at: number; run: () => void }[] = [];
  Array.from(second).forEach((char, i) => {
    events.push({ at: i * PEER_CHAR_MS, run: () => ai.edit(() => $insertAtSelection(char)) });
  });
  Array.from(EXAMPLE.youType).forEach((char, i) => {
    events.push({ at: 400 + i * YOU_CHAR_MS, run: () => cast.youType(char) });
  });
  events.sort((a, b) => a.at - b.at);
  let now = 0;
  for (const event of events) {
    await wait(event.at - now);
    now = event.at;
    event.run();
  }
  // 5. Both go idle, their carets where they stopped.
}

/**
 * Puts the parts the script changes back the way the example starts, so
 * Replay demo can run it again: the agenda back to a sentence (jot AI), and
 * Ana's to-do and row removed (Ana).
 */
export function resetDemo(cast: DemoCast): void {
  cast.ai.edit(() => {
    const list = $agendaList();
    if (list !== null && $agendaSentence() === null) {
      const sentence = $createAgendaSentence();
      list.replace(sentence);
      sentence.selectEnd();
    }
  });
  cast.ana.edit(() => {
    $todoItem(EXAMPLE.anaTodo)?.remove();
    $tableRow(EXAMPLE.anaRow[0])?.remove();
    $todoList()?.getLastChild()?.selectEnd();
  });
}

/** Where idle demo carets rest when a page opens an example it already played. */
export function placeIdleCarets(cast: DemoCast): void {
  cast.ana.edit(() => {
    $todoList()?.getLastChild()?.selectEnd();
  });
  cast.ai.edit(() => {
    const list = $agendaList();
    if (list !== null) {
      list.getLastChild()?.selectEnd();
    } else {
      $agendaSentence()?.selectEnd();
    }
  });
}
