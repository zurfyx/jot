import type { WebsocketProvider } from '@y/websocket';

/**
 * The provider retries on its own with backoff. When the browser says the
 * network is back, skip the wait and reconnect at once, unless the person
 * chose to work offline; sync step 1 and 2 then exchange whatever either side
 * wrote while apart.
 */
export function reconnectWhenOnline(provider: WebsocketProvider, workOffline: () => boolean) {
  const onOnline = () => {
    if (!provider.wsconnected && !workOffline()) {
      provider.disconnect();
      provider.connect();
    }
  };
  window.addEventListener('online', onOnline);
  return () => window.removeEventListener('online', onOnline);
}
