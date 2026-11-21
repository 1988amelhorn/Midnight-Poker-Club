import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLobbyRecovery } from '../src/lib/lobbyRecovery.ts';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function browser() {
  vi.useFakeTimers();
  const win = new EventTarget();
  Object.assign(win, { setInterval, clearInterval });
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { onLine: true });
  return { win, doc };
}

describe('lobby connection recovery', () => {
  it('retries after the first request fails, then stops on cleanup', async () => {
    browser();
    const refresh = vi.fn().mockRejectedValueOnce(new Error('Server restarting')).mockResolvedValue(undefined);
    const stop = startLobbyRecovery(refresh);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('recovers when the phone returns online or the app becomes visible', async () => {
    const { win, doc } = browser();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const stop = startLobbyRecovery(refresh);
    await vi.advanceTimersByTimeAsync(0);
    doc.visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
    win.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('does not pile up overlapping requests on repeated wake events', async () => {
    const { win } = browser();
    let complete!: () => void;
    const refresh = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    const stop = startLobbyRecovery(refresh);
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    complete();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });
});
