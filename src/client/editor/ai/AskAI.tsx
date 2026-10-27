import { type FormEvent, useEffect, useRef, useState } from 'react';

import { highlightsSupported } from '../blame/highlights';
import { Icon } from '../icons';
import { usePopover } from '../menu';
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
    <span ref={slotRef} className="ask-slot">
      <button
        type="button"
        className={`dock-button ask-button${busy ? ' is-busy' : ''}`}
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
        <Icon name="spark" />
        <span className="ask-label">{busy ? 'jot AI is writing…' : 'Ask AI…'}</span>
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
      <div className="popover ask-panel" role="dialog" aria-label="Ask AI" data-testid="ask-panel">
        <p className="ask-unavailable" data-testid="ask-unavailable">
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
    <div className="popover ask-panel" role="dialog" aria-label="Ask AI" data-testid="ask-panel">
      <form className="ask-box" onSubmit={submit}>
        <Icon name="spark" />
        <input
          ref={inputRef}
          className="ask-input"
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
            className="ask-go"
            data-testid="ask-stop"
            onClick={() => ai.cancel()}
          >
            Stop
          </button>
        ) : (
          <button type="submit" className="ask-go" disabled={!canAsk} data-testid="ask-submit">
            Ask
          </button>
        )}
      </form>
      {consent !== null && (
        <div
          className="ask-consent"
          role="group"
          aria-labelledby="ask-consent-text"
          data-testid="ask-consent"
        >
          <p id="ask-consent-text" className="ask-consent-text" aria-live="assertive">
            {consentLine(consent.model, consent.size)}
          </p>
          {device?.small === true && (
            <p className="ask-consent-note" data-testid="ask-mobile-data">
              {MOBILE_DATA_WARNING}
            </p>
          )}
          <div className="ask-consent-actions">
            <button
              ref={downloadRef}
              type="button"
              className="ask-go"
              aria-describedby="ask-consent-text"
              data-testid="ask-download"
              onClick={() => void ai.ask(text, { consent: consent.ask })}
            >
              Download
            </button>
            <button
              type="button"
              className="ask-quiet"
              data-testid="ask-decline"
              onClick={() => {
                ai.cancel();
                inputRef.current?.focus();
              }}
            >
              Not now
            </button>
            <span className="ask-consent-hint">Or pick another in ⋯ → AI model</span>
          </div>
        </div>
      )}
      {!busy && consent === null && (
        <div className="ask-chips">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="ask-chip"
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
          className={`ask-meta${phase.kind === 'error' ? ' is-error' : ''}`}
          aria-live="polite"
          data-testid="ask-meta"
        >
          {metaLine(phase, availability, info, model)}
        </p>
      )}
      {phase.kind === 'downloading' && (
        <div className="meter ask-meter" aria-hidden="true">
          <span style={{ transform: `scaleX(${phase.progress ?? 0})` }} />
        </div>
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
