const TOKEN_STORAGE_KEY = 'npc_session_token';

/**
 * Keep same-origin API calls by default. When the static frontend is hosted
 * separately, VITE_API_BASE_URL points to the HTTPS backend origin (optionally
 * including a reverse-proxy prefix).
 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function websocketUrl(token: string): string {
  const configured = (import.meta.env.VITE_WS_URL || '').trim();
  let endpoint: URL;
  if (configured) {
    endpoint = new URL(configured, window.location.href);
  } else {
    const origin = API_BASE_URL
      ? new URL(API_BASE_URL, window.location.origin)
      : new URL(window.location.origin);
    origin.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
    endpoint = new URL(`${origin.pathname.replace(/\/+$/, '')}/ws`, origin.origin);
  }
  endpoint.searchParams.set('token', token);
  return endpoint.toString();
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const token = options.token !== undefined ? options.token : getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Server took too long to respond. Please retry.')), 15_000);
  try {
    const res = await fetch(apiUrl(path), {
      cache: 'no-store',
      ...options,
      headers,
      signal: controller.signal,
    });
    // A proxy can return the app HTML with status 200 while the backend is
    // unavailable. Treat it as a failed request so lobby recovery keeps trying.
    const data = await res.json().catch(() => {
      throw new Error(`Server returned an invalid response (${res.status}). Please retry.`);
    });
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data as T;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

export function makeIdempotencyKey(prefix = 'act'): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
