import React from 'react';
import { motion } from 'motion/react';

function getChipColors(amount: number): Array<{ bg: string; rim: string }> {
  const chips: Array<{ bg: string; rim: string }> = [];
  let rem = Math.max(1, amount);
  const denoms = [
    { val: 1000, bg: 'bg-amber-400', rim: 'border-amber-200' },
    { val: 500, bg: 'bg-purple-500', rim: 'border-purple-200' },
    { val: 100, bg: 'bg-slate-900', rim: 'border-cyan-400' },
    { val: 25, bg: 'bg-emerald-500', rim: 'border-emerald-200' },
    { val: 5, bg: 'bg-rose-600', rim: 'border-rose-200' },
    { val: 1, bg: 'bg-sky-500', rim: 'border-sky-200' },
  ];
  for (const d of denoms) {
    while (rem >= d.val && chips.length < 6) {
      chips.push({ bg: d.bg, rim: d.rim });
      rem -= d.val;
    }
  }
  if (chips.length === 0) chips.push({ bg: 'bg-rose-600', rim: 'border-rose-200' });
  return chips;
}

export const ChipStack: React.FC<{
  amount: number;
  label?: string;
  size?: 'sm' | 'md';
  animateWin?: boolean;
  className?: string;
}> = ({ amount, label, size = 'sm', animateWin = false, className = '' }) => {
  if (amount <= 0) return null;
  const chips = getChipColors(amount);
  const chipDims = size === 'sm' ? 'w-5 h-5' : 'w-7 h-7';

  return (
    <motion.div
      initial={{ scale: 0.85, opacity: 0 }}
      animate={animateWin ? { scale: [1, 1.18, 1], y: [0, -8, 0], opacity: 1 } : { scale: 1, opacity: 1 }}
      transition={{ duration: animateWin ? 0.65 : 0.25 }}
      className={`inline-flex items-center gap-1.5 rounded-full bg-black/75 border border-amber-400/40 px-2.5 py-1 shadow-lg ${className}`}
    >
      <div className="relative flex items-center h-5 w-5 shrink-0">
        {chips.map((c, i) => (
          <span
            key={i}
            style={{ transform: `translateY(${-i * 2}px)` }}
            className={`absolute left-0 rounded-full border-2 border-dashed ${c.bg} ${c.rim} ${chipDims} shadow`}
          />
        ))}
      </div>
      <motion.span
        key={amount}
        initial={{ y: 6, opacity: 0.2, scale: 0.92 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 26 }}
        className="font-mono text-xs font-bold text-amber-300 tabular-nums whitespace-nowrap"
      >
        {label ? `${label} ` : ''}
        {amount.toLocaleString()}
      </motion.span>
    </motion.div>
  );
};
