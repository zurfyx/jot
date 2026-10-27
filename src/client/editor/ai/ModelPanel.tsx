import { useEffect, useRef, useState } from 'react';

import { MenuItem } from '../menu';
import type { NoteSession } from '../session';
import { useSignal } from '../useSignal';
import { aiModels } from './choice';
import { aiState } from './controller';
import {
  activeModel,
  defaultModel,
  type Device,
  MODEL_IDS,
  type ModelId,
  MODELS,
  STATE_TEXT,
} from './models';

/** "AI model" in ⋯, with the model Ask AI uses as its hint. */
export function ModelMenuItem({ open }: { session: NoteSession; open: () => void }) {
  const models = aiModels();
  const device = useSignal(models.device);
  const chosen = useSignal(models.chosen);
  useEffect(() => {
    void models.probe();
  }, [models]);
  const active = device === null ? null : activeModel(device, chosen);
  return (
    <MenuItem
      icon="spark"
      label="AI model"
      hint={active === null ? (device === null ? '' : 'None') : MODELS[active].label}
      onSelect={open}
      testId="ai-model-item"
    />
  );
}

/**
 * The AI model setting (D26): the three models, where each runs, its
 * download and its state here. Choosing one is remembered in this browser;
 * a downloaded WebLLM model can be deleted from it.
 */
export function ModelPanel({
  session,
  viaKeyboard,
}: {
  session: NoteSession;
  viaKeyboard: boolean;
}) {
  const models = aiModels();
  const device = useSignal(models.device);
  const chosen = useSignal(models.chosen);
  useSignal(models.cache);
  const phase = useSignal(aiState(session).phase);
  const [deleting, setDeleting] = useState<ModelId | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void models.probe().then(() => models.refreshCache());
  }, [models]);
  // A download that ends while the panel is open changes what is cached.
  const downloading = phase.kind === 'downloading';
  useEffect(() => {
    if (!downloading) {
      void models.refreshCache();
    }
  }, [models, downloading]);
  useEffect(() => {
    if (viaKeyboard) {
      ref.current?.focus();
    }
  }, [viaKeyboard]);
  const busy = phase.kind === 'downloading' || phase.kind === 'thinking';

  return (
    <div
      ref={ref}
      className="popover note-info model-panel"
      role="dialog"
      aria-label="AI model"
      tabIndex={-1}
      data-testid="model-panel"
    >
      <h2 className="note-info-title">AI model</h2>
      <p className="model-lede">
        Ask AI's model runs on this device, so your text never leaves it.
      </p>
      {device === null ? (
        <p className="note-info-muted">Looking at this device…</p>
      ) : (
        <ModelList
          device={device}
          chosen={chosen}
          downloading={phase.kind === 'downloading' ? phase : null}
          busy={busy}
          deleting={deleting}
          onDelete={(id) => {
            setDeleting(id);
            models
              .remove(id)
              .catch((error: unknown) => console.warn('jot: could not delete the model', error))
              .finally(() => setDeleting(null));
          }}
        />
      )}
    </div>
  );
}

function ModelList({
  device,
  chosen,
  downloading,
  busy,
  deleting,
  onDelete,
}: {
  device: Device;
  chosen: ModelId | null;
  downloading: { model: string; progress: number | null } | null;
  busy: boolean;
  deleting: ModelId | null;
  onDelete: (id: ModelId) => void;
}) {
  const models = aiModels();
  const active = activeModel(device, chosen);
  const fallback = defaultModel(device);
  return (
    <div className="model-list" role="radiogroup" aria-label="AI model">
      {MODEL_IDS.map((id) => {
        const info = MODELS[id];
        const state = models.state(id, device);
        const unsupported = state === 'unsupported';
        const inFlight = downloading !== null && downloading.model === info.name;
        const status = inFlight
          ? `Downloading${downloading.progress === null ? '' : ` ${Math.round(downloading.progress * 100)}%`}`
          : STATE_TEXT[state];
        return (
          <div
            key={id}
            className={`model-row${unsupported ? ' is-unsupported' : ''}`}
            data-testid={`model-${id}`}
          >
            <label className="model-choice">
              <input
                type="radio"
                name="jot-ai-model"
                value={id}
                checked={active === id}
                disabled={unsupported}
                onChange={() => models.choose(id)}
              />
              <span className="model-text">
                <span className="model-head">
                  <span className="model-name">
                    {info.label}
                    {fallback === id && <span className="model-default"> · default here</span>}
                  </span>
                  <span
                    className={`model-state is-${state}`}
                    data-testid={`model-${id}-state`}
                    aria-live={inFlight ? 'polite' : undefined}
                  >
                    {status}
                  </span>
                </span>
                <span className="model-sub">
                  {info.name} · {info.download === null ? 'no download' : info.download.text}
                </span>
                <span className="model-sub">{info.where}</span>
              </span>
            </label>
            {(state === 'downloaded' || state === 'ready' || state === 'partial') &&
              info.webllm !== null && (
                <button
                  type="button"
                  className="ask-quiet model-delete"
                  disabled={busy || deleting !== null}
                  aria-label={`Delete ${info.label} (${info.name}) from this browser`}
                  data-testid={`model-${id}-delete`}
                  onClick={() => onDelete(id)}
                >
                  {deleting === id ? 'Deleting…' : 'Delete'}
                </button>
              )}
          </div>
        );
      })}
    </div>
  );
}
