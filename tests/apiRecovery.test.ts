import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../src/lib/api.ts';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('API recovery', () => {
  it('releases a stalled request so a later recovery attempt can succeed', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    })).mockResolvedValueOnce(new Response(JSON.stringify({ rooms: [], multiplayerAvailable: true })));
    vi.stubGlobal('fetch', fetch);
    const request = apiFetch('/api/rooms', { token: null });
    const failed = expect(request).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(15_000);
    await failed;
    await expect(apiFetch('/api/rooms', { token: null })).resolves.toMatchObject({ multiplayerAvailable: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects proxy HTML instead of reporting a healthy empty lobby', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Unavailable</html>', { status: 200 })));
    await expect(apiFetch('/api/rooms', { token: null })).rejects.toThrow('invalid response');
  });

  it('preserves caller cancellation while applying the timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    })));
    const controller = new AbortController();
    const request = apiFetch('/api/rooms', { token: null, signal: controller.signal });
    const failed = expect(request).rejects.toThrow('Navigated away');
    controller.abort(new Error('Navigated away'));
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });
});
