/** What the Ask AI field says, from the request's phase, the model and the target. */
import { type AiPhase, MESSAGES, type TargetInfo } from './controller';
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

export function metaLine(
  phase: AiPhase,
  availability: AiAvailability | 'checking',
  info: TargetInfo | null,
): string {
  switch (phase.kind) {
    case 'error':
      return phase.message;
    case 'downloading':
      return phase.progress === null
        ? 'Downloading Gemini Nano… Esc to cancel'
        : `Downloading Gemini Nano · ${Math.round(phase.progress * 100)}% · Esc to cancel`;
    case 'thinking':
      return 'jot AI is writing… Esc to cancel';
    case 'idle': {
      if (availability === 'checking') {
        return "Looking for Chrome's built-in AI…";
      }
      const target = describeTarget(info);
      if (info === null || info.problem !== 'none') {
        return target;
      }
      return availability === 'available'
        ? `${target} · runs on this device`
        : `${target} · Gemini Nano downloads to this device on your first Ask`;
    }
  }
}
