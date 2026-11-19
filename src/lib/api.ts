const TOKEN_STORAGE_KEY = 'npc_session_token';

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

/** API failure that keeps the HTTP status so callers can tell a real auth rejection from a transient outage. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** True when the server explicitly rejected the session (sign the user out). */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

/** True when a retry can reasonably succeed: network blips, server restarts, rate limits. */
export function isTransientApiError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 404 || error.status === 429 || error.status >= 500;
  return true;
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

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverMessage = typeof data?.error === 'string' ? data.error : '';
    if (serverMessage) {
      throw new ApiError(serverMessage, res.status);
    }
    if (res.status === 404) {
      throw new ApiError(
        'The game server could not be reached (404). Please refresh in a moment and try again.',
        404
      );
    }
    throw new ApiError(`Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export function makeIdempotencyKey(prefix = 'act'): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
