import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import * as stylex from '@stylexjs/stylex';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { colors } from '../../theme/tokens.stylex';
import { highlightsSupported } from '../blame/highlights';
import { dockButton, panelButton } from '../dock.styles';
import { Icon } from '../icons';
import { popoverProps, usePopover } from '../menu';
import type { NoteSession } from '../session';
import { useEditable, useSignal } from '../useSignal';
import { aiModels } from './choice';
import { type AiPhase, type AiState, aiState, MESSAGES } from './controller';
import { consentLine, metaLine, MOBILE_DATA_WARNING } from './copy';
import { $targetBetween } from './markdown';

/** The highlight that marks the blocks a request applies to. */
export const TARGET_HIGHLIGHT = 'jot-ai-target';

/** Fill the field; they never send anything by themselves. */
const SUGGESTIONS = ['Make it a list', 'Shorter', 'Fix the spelling'];

const MAX_INSTRUCTION = 500;

const styles = stylex.create({
  spark: {
    color: colors['--ai'],
  },
  panel: {
    width: 'min(420px, calc(100vw - 24px))',
    padding: 8,
  },
  box: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    height: 46,
    paddingBlock: 0,
    paddingLeft: 12,
    paddingRight: 6,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors['--ai'],
    borderRadius: 12,
    backgroundColor: colors['--bg'],
  },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    minWidth: 0,
    height: '100%',
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colors['--ink'],
    fontFamily: 'inherit',
    fontSize: 15,
    fontWeight: 'inherit',
    fontStyle: 'inherit',
    fontStretch: 'inherit',
    fontVariantNumeric: 'inherit',
    lineHeight: 'inherit',
    outlineStyle: 'none',
    '::placeholder': {
      color: colors['--muted'],
    },
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  chip: {
    paddingBlock: 5,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: colors['--rule'],
      ':hover': colors['--rule-strong'],
      ':focus-visible': colors['--rule-strong'],
    },
    borderRadius: 999,
    color: colors['--body'],
    fontSize: '12.5px',
    lineHeight: 1.2,
    backgroundColor: {
      default: null,
      ':hover': colors['--hover'],
      ':focus-visible': colors['--hover'],
    },
    outlineStyle: { default: null, ':hover': 'none', ':focus-visible': 'none' },
  },
  meta: {
    marginTop: 8,
    marginInline: 4,
    marginBottom: 2,
    color: colors['--muted'],
    fontSize: 12,
    lineHeight: 1.4,
  },
  error: {
    color: colors['--bad'],
  },
  /**
   * The download's meter: Astryx's ProgressBar in jot AI's violet on
   * --hover (its track and fill shape are theme overrides in jotTheme.ts).
   */
  meter: {
    width: 'auto',
    minWidth: 0,
    marginTop: 6,
    marginInline: 4,
    marginBottom: 2,
    '--color-accent': colors['--ai'],
    '--color-background-muted': colors['--hover'],
  },
  unavailable: {
    marginBlock: 6,
    marginInline: 8,
    color: colors['--body'],
    lineHeight: 1.45,
  },
  consent: {
    marginTop: 8,
    marginInline: 4,
    marginBottom: 2,
    color: colors['--body'],
    fontSize: 13,
    lineHeight: 1.45,
  },
  consentText: {
    margin: 0,
  },
  consentNote: {
    marginTop: 4,
    marginInline: 0,
    marginBottom: 0,
    color: colors['--muted'],
    fontSize: 12,
  },
  consentActions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  consentHint: {
    color: colors['--muted'],
    fontSize: 12,
  },
});

function isBusy(phase: AiPhase): boolean {
  return phase.kind === 'downloading' || phase.kind === 'thinking';
}

/** "✦ Ask AI…" in the dock, between Aa and ⋯, and its field. */
export function AskAIDockItem({ session }: { session: NoteSession }) {
  const ai = aiState(session);
  const phase = useSignal(ai.phase);
  const written = useSignal(ai.written);
  const editable = useEditable(session.editor);
  const slotRef = useRef<HTMLSpanElement>(null);
  const { open, close, toggle } = usePopover<'ask'>(slotRef, () => {
    ai.release();
    if (slotRef.current?.contains(document.activeElement)) {
      session.editor.focus();
    }
  });
  const busy = isBusy(phase);

  // jot AI wrote: the field is done.
  const seen = useRef(written);
  useEffect(() => {
    if (written !== seen.current) {
      seen.current = written;
      close();
    }
  }, [written, close]);
  // A note that turns read only closes the field (a running request stops on its own).
  useEffect(() => {
    if (!editable && open !== null && !busy) {
      close();
    }
  }, [editable, open, busy, close]);

  return (
    <span ref={slotRef}>
      <button
        type="button"
        {...stylex.props(dockButton.base, dockButton.ask, busy && dockButton.askBusy)}
        aria-haspopup="dialog"
        aria-expanded={open === 'ask'}
        title={editable ? 'Ask AI' : 'Ask AI (this note is read only)'}
        disabled={!editable && !busy}
        data-testid="ask-ai"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          if (open !== 'ask') {
            // The page's selection, before the field takes the focus (a
            // running request keeps its own).
            ai.capture();
          }
          if (open !== 'ask') {
            void ai.refresh();
          }
          toggle('ask', event.detail);
        }}
      >
        <Icon name="spark" xstyle={styles.spark} />
        <span>{busy ? 'jot AI is writing…' : 'Ask AI…'}</span>
      </button>
      {open === 'ask' && <AskPanel ai={ai} />}
    </span>
  );
}

function AskPanel({ ai }: { ai: AiState }) {
  const availability = useSignal(ai.availability);
  const model = useSignal(ai.model);
  const reason = useSignal(ai.reason);
  const phase = useSignal(ai.phase);
  const info = useSignal(ai.targetInfo);
  const device = useSignal(aiModels().device);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = isBusy(phase);
  const unavailable = availability === 'missing' || availability === 'unavailable';

  useEffect(() => {
    if (!unavailable) {
      inputRef.current?.focus();
    }
  }, [unavailable]);

  const consent = phase.kind === 'consent' ? phase : null;
  const chosen = useSignal(aiModels().chosen);
  const downloadRef = useRef<HTMLButtonElement>(null);
  // The question is for one model: a change in the setting withdraws it.
  const asked = useRef(chosen);
  useEffect(() => {
    if (asked.current !== chosen) {
      asked.current = chosen;
      ai.dismiss();
    }
  }, [chosen, ai]);
  // The question takes the focus, so a screen reader reads it (and Enter downloads).
  const questionShown = consent !== null;
  useEffect(() => {
    if (questionShown) {
      downloadRef.current?.focus();
    }
  }, [questionShown]);

  if (unavailable) {
    return (
      <div
        {...popoverProps(styles.panel)}
        role="dialog"
        aria-label="Ask AI"
        data-testid="ask-panel"
      >
        <p {...stylex.props(styles.unavailable)} data-testid="ask-unavailable">
          {reason ?? MESSAGES.unavailable}
        </p>
      </div>
    );
  }

  const canAsk =
    availability !== 'checking' &&
    consent === null &&
    text.trim() !== '' &&
    info !== null &&
    info.problem === 'none' &&
    !busy;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canAsk) {
      void ai.ask(text);
    }
  };

  return (
    <div {...popoverProps(styles.panel)} role="dialog" aria-label="Ask AI" data-testid="ask-panel">
      <form {...stylex.props(styles.box)} onSubmit={submit}>
        <Icon name="spark" xstyle={styles.spark} />
        <input
          ref={inputRef}
          {...stylex.props(styles.input)}
          type="text"
          value={text}
          maxLength={MAX_INSTRUCTION}
          placeholder="Tell jot AI what to change"
          aria-label="Instruction for jot AI"
          readOnly={busy}
          autoComplete="off"
          enterKeyHint="send"
          data-testid="ask-input"
          onChange={(event) => {
            setText(event.target.value);
            ai.dismiss();
          }}
        />
        {busy ? (
          <button
            type="button"
            {...stylex.props(panelButton.go)}
            data-testid="ask-stop"
            onClick={() => ai.cancel()}
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            {...stylex.props(panelButton.go)}
            disabled={!canAsk}
            data-testid="ask-submit"
          >
            Ask
          </button>
        )}
      </form>
      {consent !== null && (
        <div
          {...stylex.props(styles.consent)}
          role="group"
          aria-labelledby="ask-consent-text"
          data-testid="ask-consent"
        >
          <p id="ask-consent-text" {...stylex.props(styles.consentText)} aria-live="assertive">
            {consentLine(consent.model, consent.size)}
          </p>
          {device?.small === true && (
            <p {...stylex.props(styles.consentNote)} data-testid="ask-mobile-data">
              {MOBILE_DATA_WARNING}
            </p>
          )}
          <div {...stylex.props(styles.consentActions)}>
            <button
              ref={downloadRef}
              type="button"
              {...stylex.props(panelButton.go)}
              aria-describedby="ask-consent-text"
              data-testid="ask-download"
              onClick={() => void ai.ask(text, { consent: consent.ask })}
            >
              Download
            </button>
            <button
              type="button"
              {...stylex.props(panelButton.quiet)}
              data-testid="ask-decline"
              onClick={() => {
                ai.cancel();
                inputRef.current?.focus();
              }}
            >
              Not now
            </button>
            <span {...stylex.props(styles.consentHint)}>Or pick another in ⋯ → AI model</span>
          </div>
        </div>
      )}
      {!busy && consent === null && (
        <div {...stylex.props(styles.chips)}>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              {...stylex.props(styles.chip)}
              onClick={() => {
                setText(suggestion);
                ai.dismiss();
                inputRef.current?.focus();
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      {consent === null && (
        <p
          {...stylex.props(styles.meta, phase.kind === 'error' && styles.error)}
          aria-live="polite"
          data-testid="ask-meta"
        >
          {metaLine(phase, availability, info, model)}
        </p>
      )}
      {phase.kind === 'downloading' && (
        <ProgressBar
          label="Download"
          isLabelHidden
          value={phase.progress ?? 0}
          max={1}
          xstyle={styles.meter}
          aria-hidden="true"
          data-testid="ask-meter"
        />
      )}
    </div>
  );
}

/**
 * On the note's surface: tints the blocks a request applies to, makes Esc
 * cancel a running request anywhere on the page, and has jot AI leave the
 * note with the page.
 */
export function AskAISurface({ session }: { session: NoteSession }) {
  const ai = aiState(session);
  useEffect(() => () => ai.stop(), [ai]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isBusy(ai.phase.peek())) {
        ai.cancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [ai]);
  useEffect(() => paintTarget(session, ai), [session, ai]);
  return null;
}

function paintTarget(session: NoteSession, ai: AiState): () => void {
  if (!highlightsSupported()) {
    return () => undefined;
  }
  const { editor, binding } = session;
  const paint = () => {
    const cursor = ai.target.peek();
    let range: Range | null = null;
    if (cursor !== null) {
      try {
        range = editor.getEditorState().read(() => {
          const points = binding.$resolveCursor(cursor);
          const found = points && $targetBetween(points.anchor, points.focus);
          const first = found?.blocks[0];
          const last = found?.blocks[found.blocks.length - 1];
          const start = first && editor.getElementByKey(first.getKey());
          const end = last && editor.getElementByKey(last.getKey());
          if (!start || !end) {
            return null;
          }
          const span = document.createRange();
          span.setStart(start, 0);
          span.setEnd(end, end.childNodes.length);
          return span;
        });
      } catch {
        range = null;
      }
    }
    if (range === null) {
      CSS.highlights.delete(TARGET_HIGHLIGHT);
    } else {
      CSS.highlights.set(TARGET_HIGHLIGHT, new Highlight(range));
    }
  };
  const stops = [ai.target.subscribe(paint), editor.registerUpdateListener(paint)];
  return () => {
    for (const stop of stops) {
      stop();
    }
    CSS.highlights.delete(TARGET_HIGHLIGHT);
  };
}
