import type { Page } from '@playwright/test';

const NOTE_SOCKET = /\/api\/n\//;

/**
 * Holds the page's outgoing sync step 2 and updates (its content) while
 * `hold` is on, and lets everything else through, so the server syncs the
 * page but has not received its edits yet. `release()` sends what was held,
 * in order.
 */
export async function holdOutgoingContent(page: Page) {
  const held: { send: () => void }[] = [];
  const control = {
    hold: false,
    release() {
      control.hold = false;
      for (const message of held.splice(0)) {
        message.send();
      }
    },
  };
  await page.routeWebSocket(NOTE_SOCKET, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const bytes = typeof message === 'string' ? Buffer.from(message) : message;
      // y-websocket sync (0), subtype step 2 (1) or update (2).
      const content = bytes[0] === 0 && (bytes[1] === 1 || bytes[1] === 2);
      if (control.hold && content) {
        held.push({ send: () => server.send(message) });
      } else {
        server.send(message);
      }
    });
  });
  return control;
}
