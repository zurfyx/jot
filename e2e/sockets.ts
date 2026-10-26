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

/**
 * A link that can die: while `up`, everything passes. `goSilent()` stops
 * delivering the page's content (as a dead link swallows it) while the socket
 * still looks open; `drop()` then closes it and refuses new sockets until
 * `restore()`.
 */
export async function flakyLink(page: Page) {
  const sockets = new Set<{ close: () => void }>();
  const control = {
    silent: false,
    down: false,
    goSilent() {
      control.silent = true;
    },
    drop() {
      control.down = true;
      for (const socket of sockets) {
        socket.close();
      }
      sockets.clear();
    },
    restore() {
      control.silent = false;
      control.down = false;
    },
  };
  await page.routeWebSocket(NOTE_SOCKET, (ws) => {
    if (control.down) {
      void ws.close({ code: 1001, reason: 'network down' });
      return;
    }
    const server = ws.connectToServer();
    const entry = { close: () => void ws.close({ code: 1001, reason: 'network down' }) };
    sockets.add(entry);
    ws.onClose(() => sockets.delete(entry));
    ws.onMessage((message) => {
      if (!control.silent) {
        server.send(message);
      }
    });
  });
  return control;
}
