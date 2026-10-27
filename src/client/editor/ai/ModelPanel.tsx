import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';

import { colors } from '../../theme/tokens.stylex';
import { panelButton } from '../dock.styles';
import { MenuItem, popoverProps } from '../menu';
import { infoStyles } from '../NoteInfo';
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

const styles = stylex.create({
  panel: {
    width: 'min(360px, calc(100vw - 24px))',
  },
  lede: {
    marginTop: 4,
    marginInline: 0,
    marginBottom: 8,
    color: colors['--muted'],
    fontSize: 12,
    lineHeight: 1.4,
  },
  list: {
    display: 'grid',
    gap: 2,
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    paddingBlock: 8,
    paddingInline: 6,
    borderRadius: 8,
    backgroundColor: { default: null, ':hover': colors['--hover'] },
  },
  rowUnsupported: {
    backgroundColor: null,
  },
  choice: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    minWidth: 0,
    alignItems: 'flex-start',
    gap: 10,
    cursor: 'pointer',
  },
  choiceUnsupported: {
    cursor: 'default',
  },
  radio: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    marginTop: 3,
    marginInline: 0,
    marginBottom: 0,
    accentColor: colors['--ai'],
  },
  text: {
    display: 'grid',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    minWidth: 0,
    gap: 1,
  },
  head: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  name: {
    color: colors['--ink'],
    fontWeight: 550,
  },
  sub: {
    color: colors['--muted'],
    fontSize: 12,
    fontWeight: 400,
  },
  muted: {
    color: colors['--muted'],
  },
  state: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    color: colors['--muted'],
    fontSize: 12,
    textAlign: 'right',
  },
  stateOk: {
    color: colors['--ok'],
  },
  delete: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    alignSelf: 'center',
  },
});

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
      {...popoverProps(infoStyles.panel, styles.panel)}
      role="dialog"
      aria-label="AI model"
      tabIndex={-1}
      data-testid="model-panel"
    >
      <h2 {...stylex.props(infoStyles.title)}>AI model</h2>
      <p {...stylex.props(styles.lede)}>
        Ask AI's model runs on this device, so your text never leaves it.
      </p>
      {device === null ? (
        <p {...stylex.props(infoStyles.muted)}>Looking at this device…</p>
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
  downloading: { model: string; loading: boolean; progress: number | null } | null;
  busy: boolean;
  deleting: ModelId | null;
  onDelete: (id: ModelId) => void;
}) {
  const models = aiModels();
  const active = activeModel(device, chosen);
  const fallback = defaultModel(device);
  return (
    <div {...stylex.props(styles.list)} role="radiogroup" aria-label="AI model">
      {MODEL_IDS.map((id) => {
        const info = MODELS[id];
        const state = models.state(id, device);
        const unsupported = state === 'unsupported';
        const inFlight = downloading !== null && downloading.model === info.name;
        const status = inFlight
          ? `${downloading.loading ? 'Loading' : 'Downloading'}${
              downloading.progress === null ? '' : ` ${Math.round(downloading.progress * 100)}%`
            }`
          : STATE_TEXT[state];
        return (
          <div
            key={id}
            {...stylex.props(styles.row, unsupported && styles.rowUnsupported)}
            data-testid={`model-${id}`}
          >
            <label {...stylex.props(styles.choice, unsupported && styles.choiceUnsupported)}>
              <input
                type="radio"
                {...stylex.props(styles.radio)}
                name="jot-ai-model"
                value={id}
                checked={active === id}
                disabled={unsupported}
                onChange={() => models.choose(id)}
              />
              <span {...stylex.props(styles.text)}>
                <span {...stylex.props(styles.head)}>
                  <span {...stylex.props(styles.name, unsupported && styles.muted)}>
                    {info.label}
                    {fallback === id && <span {...stylex.props(styles.sub)}> · default here</span>}
                  </span>
                  <span
                    {...stylex.props(
                      styles.state,
                      (state === 'ready' || state === 'downloaded') && styles.stateOk,
                    )}
                    data-testid={`model-${id}-state`}
                    aria-live={inFlight ? 'polite' : undefined}
                  >
                    {status}
                  </span>
                </span>
                <span {...stylex.props(styles.sub)}>
                  {info.name} · {info.download === null ? 'no download' : info.download.text}
                </span>
                <span {...stylex.props(styles.sub)}>{info.where}</span>
              </span>
            </label>
            {(state === 'downloaded' || state === 'ready' || state === 'partial') &&
              info.webllm !== null && (
                <button
                  type="button"
                  {...stylex.props(panelButton.quiet, styles.delete)}
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
