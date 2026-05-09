// Resolves the BaaS REST + WS URLs at runtime from the current page's
// hostname. Avoids the localhost/127.0.0.1 mismatch that triggers
// browser CORS preflights when the page and the BaaS use different
// host literals for the same loopback address.
//
// Override either via VITE_BAAS_BASE_URL / VITE_WS_URL when the BaaS
// is on a different host (e.g. behind a reverse proxy).

const DEFAULT_BAAS_PORT = 8090;

function defaultBaseUrl(): string {
  if (typeof window === 'undefined') return `http://127.0.0.1:${DEFAULT_BAAS_PORT}`;
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${DEFAULT_BAAS_PORT}`;
}

function defaultWsUrl(): string {
  if (typeof window === 'undefined') return `ws://127.0.0.1:${DEFAULT_BAAS_PORT}/ws`;
  const { protocol, hostname } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${hostname}:${DEFAULT_BAAS_PORT}/ws`;
}

export const BAAS_BASE_URL: string =
  (import.meta.env.VITE_BAAS_BASE_URL as string | undefined) ?? defaultBaseUrl();

export const BAAS_WS_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) ?? defaultWsUrl();
