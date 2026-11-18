import React from 'react';

export interface AvatarOption {
  id: string;
  label: string;
  gradient: string;
  ring: string;
  symbol: string;
}

export const AVATAR_OPTIONS: AvatarOption[] = [
  { id: 'ace-spade', label: 'Midnight Ace', gradient: 'from-cyan-500 to-blue-700', ring: 'border-cyan-400', symbol: '♠' },
  { id: 'king-gold', label: 'Gold Crown', gradient: 'from-amber-400 to-orange-600', ring: 'border-amber-400', symbol: '♛' },
  { id: 'cyber-heart', label: 'Crimson Heart', gradient: 'from-rose-500 to-pink-700', ring: 'border-rose-400', symbol: '♥' },
  { id: 'emerald-club', label: 'Emerald Shark', gradient: 'from-emerald-400 to-teal-700', ring: 'border-emerald-400', symbol: '♣' },
  { id: 'violet-diamond', label: 'Violet VIP', gradient: 'from-purple-500 to-indigo-700', ring: 'border-purple-400', symbol: '♦' },
  { id: 'obsidian-pro', label: 'Shadow Pro', gradient: 'from-slate-600 to-slate-900', ring: 'border-sky-400', symbol: '★' },
  { id: 'sunset-high', label: 'Miami High', gradient: 'from-fuchsia-500 to-amber-500', ring: 'border-fuchsia-400', symbol: '⚡' },
  { id: 'royal-flush', label: 'Royal Crest', gradient: 'from-blue-500 to-violet-700', ring: 'border-yellow-400', symbol: '♔' },
];

export const PlayerAvatar: React.FC<{
  avatarId?: string;
  username?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}> = ({ avatarId = 'ace-spade', username, size = 'md', className = '' }) => {
  const opt = AVATAR_OPTIONS.find((a) => a.id === avatarId) ?? AVATAR_OPTIONS[0];
  const dims =
    size === 'xs'
      ? 'w-7 h-7 text-xs'
      : size === 'sm'
        ? 'w-9 h-9 text-sm'
        : size === 'md'
          ? 'w-11 h-11 text-base'
          : size === 'lg'
            ? 'w-14 h-14 text-xl'
            : 'w-20 h-20 text-3xl';

  const initial = username ? username.slice(0, 1).toUpperCase() : opt.symbol;

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full bg-gradient-to-br ${opt.gradient} border-2 ${opt.ring} text-white font-display font-bold shadow-[0_0_16px_rgba(56,189,248,0.35),0_6px_14px_rgba(0,0,0,0.5)] shrink-0 select-none overflow-hidden ${dims} ${className}`}
      aria-label={username ? `${username} avatar` : opt.label}
    >
      <span className="pointer-events-none absolute inset-x-1 top-0.5 h-1/2 rounded-full bg-gradient-to-b from-white/40 to-transparent" />
      <span className="relative z-10 drop-shadow">{opt.symbol}</span>
      {username && size !== 'xs' && (
        <span className="sr-only">{initial}</span>
      )}
    </div>
  );
};
