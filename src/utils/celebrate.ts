import confetti from 'canvas-confetti';

const NEON_PALETTE = ['#38bdf8', '#a855f7', '#facc15', '#34d399', '#f472b6'];

/**
 * Small celebratory burst when a hand is won.
 * 'hand' = someone at the table won, 'big' = the local player won.
 * Honours reduced-motion preferences and never blocks the table.
 */
export function celebrateWin(kind: 'hand' | 'big' = 'hand', enabled = true): void {
  if (!enabled || typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const base = {
    colors: NEON_PALETTE,
    disableForReducedMotion: true,
    zIndex: 80,
  };

  void confetti({
    ...base,
    particleCount: kind === 'big' ? 130 : 55,
    spread: kind === 'big' ? 100 : 70,
    startVelocity: kind === 'big' ? 52 : 38,
    scalar: 1.02,
    origin: { x: 0.5, y: 0.62 },
  });

  if (kind === 'big') {
    setTimeout(() => {
      void confetti({ ...base, particleCount: 70, spread: 120, angle: 60, origin: { x: 0.15, y: 0.7 } });
    }, 180);
    setTimeout(() => {
      void confetti({ ...base, particleCount: 70, spread: 120, angle: 120, origin: { x: 0.85, y: 0.7 } });
    }, 260);
  }
}
