import { useEffect, useRef, useState } from 'react';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page without clipboard permission.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function copyNoteLink(): Promise<boolean> {
  return copyText(window.location.href);
}

/** Copies the note's link and confirms in place. */
export function ShareButton() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  return (
    <button
      type="button"
      className="button-ghost share-button"
      onClick={async () => {
        if (await copyNoteLink()) {
          setCopied(true);
          clearTimeout(timer.current ?? undefined);
          timer.current = setTimeout(() => setCopied(false), 1800);
        }
      }}
    >
      <span key={copied ? 'copied' : 'share'} className="swap">
        {copied ? 'Link copied' : 'Share'}
      </span>
    </button>
  );
}
