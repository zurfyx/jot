/** What the Ask AI field says, from the request's phase, the model and the target. */
import type { AiModelView, AiPhase, TargetInfo } from './controller';
import { MESSAGES } from './controller';
import type { AiAvailability } from './prompt-api';

export function describeTarget(info: TargetInfo | null): string {
  if (info === null) {
    return MESSAGES.noTarget;
  }
  if (info.problem === 'table') {
    return MESSAGES.table;
  }
  if (info.empty) {
    return 'Writes into the empty line';
  }
  if (info.list) {
    return 'Rewrites the whole list';
  }
  return info.blocks === 1 ? 'Rewrites this block' : `Rewrites ${info.blocks} blocks`;
}

function percent(progress: number | null): string {
  return progress === null ? '' : ` · ${Math.round(progress * 100)}%`;
}

export function metaLine(
  phase: AiPhase,
  availability: AiAvailability | 'checking',
  info: TargetInfo | null,
  model: AiModelView | null,
): string {
  switch (phase.kind) {
    case 'error':
      return phase.message;
    case 'consent':
      return consentLine(phase.model, phase.size);
    case 'downloading':
      return `${phase.loading ? 'Loading' : 'Downloading'} ${phase.model}${percent(phase.progress)} · Esc to cancel`;
    case 'thinking':
      return 'jot AI is writing… Esc to cancel';
    case 'idle': {
      if (availability === 'checking' || model === null) {
        return 'Looking for a model on this device…';
      }
      const target = describeTarget(info);
      if (info === null || info.problem !== 'none') {
        return target;
      }
      if (availability === 'available') {
        return `${target} · ${model.name}, on this device`;
      }
      return model.consent === null
        ? `${target} · ${model.name} downloads to this device on your first Ask`
        : `${target} · ${model.name} (${model.consent.text}) downloads after you agree`;
    }
  }
}

/** The download question, before anything is fetched. */
export function consentLine(model: string, size: string): string {
  return `Ask AI needs a ${size} model on this device (${model}). Download it?`;
}

/** Said under the question on a phone, where the download may cost data. */
export const MOBILE_DATA_WARNING =
  'On mobile data this counts against your plan, so Wi-Fi is better. It downloads once.';
