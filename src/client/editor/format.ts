import { NOTE_EXPIRY_MS } from '../../shared/limits';

/**
 * A Yjs size for people: "512 B", "4.2 KB", "238 KB", "1.72 MB". Decimal
 * units, so the 2,000,000-byte cap reads "2 MB".
 */
export function formatBytes(bytes: number): string {
  const value = Math.max(0, Math.round(bytes));
  if (value < 1000) {
    return `${value} B`;
  }
  if (value < 1_000_000) {
    const kb = value / 1000;
    return `${kb < 10 ? trim(kb.toFixed(1)) : Math.round(kb)} KB`;
  }
  return `${trim((value / 1_000_000).toFixed(2))} MB`;
}

function trim(fixed: string): string {
  return fixed.replace(/\.?0+$/, '');
}

/** "3 edits waiting", "1 edit waiting", "no edits waiting". */
export function editsWaiting(count: number): string {
  if (count <= 0) {
    return 'no edits waiting';
  }
  return `${count} ${count === 1 ? 'edit' : 'edits'} waiting`;
}

/** When a note visited at `now` is deleted if nobody visits again (D06). */
export function keptUntil(now: number): string {
  return new Date(now + NOTE_EXPIRY_MS).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", from Unix seconds. */
export function ago(seconds: number, now: number = Date.now()): string {
  const minutes = Math.floor((now / 1000 - seconds) / 60);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
