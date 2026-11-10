import { $isCodeNode } from '@lexical/code-core';
import { $findMatchingParent } from '@lexical/utils';
import * as stylex from '@stylexjs/stylex';
import { $getNodeByKey, $getSelection, $isRangeSelection } from 'lexical';
import { type RefObject, useEffect, useState } from 'react';

import { colors, fonts } from '../../theme/tokens.stylex';
import { Icon } from '../icons';
import type { NoteSession } from '../session';
import { useEditable } from '../useSignal';
import { CODE_LANGUAGES, codeLanguageId } from './languages';

const styles = stylex.create({
  // In the code block's top right corner, on its own background, so the
  // code under it doesn't show through.
  picker: {
    position: 'absolute',
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    borderRadius: 6,
    backgroundColor: colors['--hover'],
    color: { default: colors['--muted'], ':hover': colors['--ink'] },
  },
  select: {
    appearance: 'none',
    paddingBlock: 3,
    paddingLeft: 8,
    paddingRight: 22,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: 'transparent',
    color: 'inherit',
    fontFamily: fonts['--sans'],
    fontSize: '12.5px',
    lineHeight: 1.3,
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: colors['--accent'],
  },
  chevron: {
    position: 'absolute',
    right: 4,
    width: 14,
    height: 14,
    pointerEvents: 'none',
  },
});

interface Block {
  key: string;
  language: string | null | undefined;
  top: number;
  right: number;
}

/**
 * The language of the code block the caret is in, as a picker in its top
 * right corner (D35). Choosing one stores it on the block, and the
 * highlighter tokenizes the block again; collaborators see the new language
 * and its colours like any other edit. Hidden while the note is read only.
 */
export function CodeLanguagePicker({
  session,
  surfaceRef,
}: {
  session: NoteSession;
  surfaceRef: RefObject<HTMLDivElement | null>;
}) {
  const { editor } = session;
  const editable = useEditable(editor);
  const [block, setBlock] = useState<Block | null>(null);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const surface = surfaceRef.current;
      const code = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return null;
        }
        const node = $findMatchingParent(selection.anchor.getNode(), $isCodeNode);
        return node === null ? null : { key: node.getKey(), language: node.getLanguage() };
      });
      const element = code === null ? null : editor.getElementByKey(code.key);
      if (code === null || element === null || surface === null) {
        setBlock(null);
        return;
      }
      const origin = surface.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      setBlock({
        ...code,
        top: rect.top - origin.top + 6,
        right: origin.right - rect.right + 6,
      });
    };
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(measure);
      }
    };
    schedule();
    const stopUpdates = editor.registerUpdateListener(schedule);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      stopUpdates();
      window.removeEventListener('resize', schedule);
    };
  }, [editor, surfaceRef]);

  if (!editable || block === null) {
    return null;
  }
  const value = codeLanguageId(block.language);
  const listed = CODE_LANGUAGES.some(([id]) => id === value);
  return (
    <div {...stylex.props(styles.picker)} style={{ top: block.top, right: block.right }}>
      <select
        {...stylex.props(styles.select)}
        aria-label="Code language"
        value={value}
        onChange={(event) => {
          const language = event.target.value;
          if (!editor.isEditable()) {
            return;
          }
          editor.update(() => {
            const node = $getNodeByKey(block.key);
            if ($isCodeNode(node)) {
              node.setLanguage(language);
            }
          });
          editor.focus();
        }}
      >
        {/* A language from elsewhere (```ruby) stays as it is until someone picks another. */}
        {!listed && <option value={value}>{value}</option>}
        {CODE_LANGUAGES.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <Icon name="chevron" xstyle={styles.chevron} />
    </div>
  );
}
