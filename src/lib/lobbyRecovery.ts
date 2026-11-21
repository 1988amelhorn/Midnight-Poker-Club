/** Retry independently of socket/offline state, including after a phone resumes. */
export function startLobbyRecovery(refreshLobby: () => Promise<void>): () => void {
  let stopped = false;
  let inFlight = false;
  const refresh = async () => {
    if (stopped || inFlight || navigator.onLine === false || document.visibilityState === 'hidden') return;
    inFlight = true;
    try {
      await refreshLobby();
    } catch {
      // A failed request must not stop later recovery attempts.
    } finally {
      inFlight = false;
    }
  };
  void refresh();
  const timer = window.setInterval(() => void refresh(), 10_000);
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('online', refresh);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
}
