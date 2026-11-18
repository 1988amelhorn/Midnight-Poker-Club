import React from 'react';
import { motion } from 'motion/react';
import type { Card } from '../shared/types.ts';

const RANK_LABELS: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

const SUIT_SYMBOLS: Record<Card['suit'], string> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
};

export const PlayingCard: React.FC<{
  card?: Card | null;
  faceDown?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'board' | 'hole';
  highlighted?: boolean;
  dimmed?: boolean;
  foldedAway?: boolean;
  dealDelaySec?: number;
  dealFrom?: { x: number; y: number };
  reducedMotion?: boolean;
  className?: string;
}> = ({
  card,
  faceDown = false,
  size = 'md',
  highlighted = false,
  dimmed = false,
  foldedAway = false,
  dealDelaySec = 0,
  dealFrom = { x: 0, y: -42 },
  reducedMotion = false,
  className = '',
}) => {
  const dims =
    size === 'xs'
      ? 'w-7 h-10 sm:w-8 sm:h-11 rounded-md text-[9px] sm:text-[10px]'
      : size === 'sm'
        ? 'w-10 h-14 sm:w-11 sm:h-16 rounded-lg text-[11px] sm:text-xs'
        : size === 'hole'
          ? 'w-11 h-16 sm:w-14 sm:h-20 rounded-lg text-xs sm:text-sm'
          : size === 'board'
            ? 'w-11 h-16 sm:w-14 sm:h-20 md:w-16 md:h-[90px] rounded-lg text-xs sm:text-sm'
            : size === 'md'
              ? 'w-14 h-20 sm:w-16 sm:h-[90px] rounded-lg text-sm'
              : 'w-16 h-24 sm:w-20 sm:h-28 rounded-xl text-base';

  const isRed = card ? card.suit === 'h' || card.suit === 'd' : false;
  const rankText = card ? RANK_LABELS[card.rank] : '';
  const suitSymbol = card ? SUIT_SYMBOLS[card.suit] : '';
  const showBack = faceDown || !card;

  return (
    <motion.div
      initial={
        reducedMotion
          ? false
          : { opacity: 0, x: dealFrom.x, y: dealFrom.y, scale: 0.55 }
      }
      animate={
        foldedAway
          ? { opacity: 0, x: dealFrom.x * 0.6, y: dealFrom.y * 0.6, scale: 0.55 }
          : { opacity: dimmed ? 0.48 : 1, x: 0, y: highlighted ? -4 : 0, scale: highlighted ? 1.07 : 1 }
      }
      transition={{
        duration: reducedMotion ? 0.05 : 0.34,
        delay: reducedMotion || foldedAway ? 0 : dealDelaySec,
        ease: [0.16, 1, 0.3, 1],
      }}
      style={{ willChange: 'transform, opacity' }}
      className={`perspective-1000 relative select-none shrink-0 ${dims} ${className}`}
    >
      <motion.div
        animate={{ rotateY: showBack ? 180 : 0 }}
        transition={{ duration: reducedMotion ? 0.05 : 0.45, ease: [0.22, 1, 0.36, 1] }}
        style={{ willChange: 'transform' }}
        className={`preserve-3d relative w-full h-full rounded-[inherit] transition-shadow ${
          highlighted
            ? 'ring-2 ring-amber-400 shadow-[0_0_24px_rgba(250,204,21,0.9),0_0_40px_rgba(16,185,129,0.55)]'
            : 'shadow-[0_6px_16px_rgba(0,0,0,0.65)]'
        }`}
      >
        {/* Front Face */}
        <div
          className={`backface-hidden absolute inset-0 rounded-[inherit] bg-gradient-to-br from-white via-slate-50 to-slate-200 border ${
            highlighted ? 'border-amber-400' : 'border-slate-300'
          } flex flex-col justify-between p-1 sm:p-1.5 overflow-hidden`}
        >
          {card && (
            <>
              <div className={`flex flex-col items-center leading-none self-start font-display font-extrabold ${isRed ? 'text-rose-600' : 'text-slate-900'}`}>
                <span>{rankText}</span>
                <span className="text-[0.82em] -mt-0.5">{suitSymbol}</span>
              </div>

              <div className={`flex items-center justify-center leading-none ${
                size === 'xs'
                  ? 'text-sm sm:text-base'
                  : size === 'sm'
                    ? 'text-lg sm:text-xl'
                    : size === 'hole' || size === 'board'
                      ? 'text-lg sm:text-2xl'
                      : size === 'md'
                        ? 'text-2xl sm:text-3xl'
                        : 'text-3xl sm:text-4xl'
              } ${isRed ? 'text-rose-600' : 'text-slate-900'}`}>
                {suitSymbol}
              </div>

              <div className={`flex flex-col items-center leading-none self-end rotate-180 font-display font-extrabold ${isRed ? 'text-rose-600' : 'text-slate-900'}`}>
                <span>{rankText}</span>
                <span className="text-[0.82em] -mt-0.5">{suitSymbol}</span>
              </div>
            </>
          )}
        </div>

        {/* Ornate Back Face */}
        <div className="backface-hidden rotate-y-180 absolute inset-0 rounded-[inherit] bg-white p-[2px] border border-sky-300/60">
          <div className="w-full h-full rounded-[calc(inherit-2px)] card-back-pattern border border-sky-300/40 flex items-center justify-center">
            <div className="w-4/6 h-4/6 rounded border border-sky-300/35 flex items-center justify-center">
              <span className="text-sky-200/80 text-xs font-display font-bold">♠</span>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
