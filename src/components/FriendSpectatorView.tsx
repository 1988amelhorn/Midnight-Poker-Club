import React, { useEffect, useState } from 'react';
import { ChevronLeft, Eye, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { BlackjackTableView, GameRoomSummary, PokerTableView } from '../shared/types.ts';
import { PlayingCard } from './PlayingCard.tsx';

interface SpectatorSnapshot {
  room: GameRoomSummary;
  poker: PokerTableView | null;
  blackjack: BlackjackTableView | null;
  friendId: string;
}

/** Friend-only spectator screen. All data is read-only and authorized server-side. */
export const FriendSpectatorView: React.FC<{
  roomId: string;
  friendId: string;
  friendName: string;
  onExit: () => void;
}> = ({ roomId, friendId, friendName, onExit }) => {
  const [snapshot, setSnapshot] = useState<SpectatorSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const result = await apiFetch<SpectatorSnapshot>(
          `/api/rooms/${encodeURIComponent(roomId)}/spectate?friendId=${encodeURIComponent(friendId)}`
        );
        if (!cancelled) {
          setSnapshot(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not watch this game');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          // No overlapping requests; slower polling keeps free-tier usage modest.
          timeout = setTimeout(load, 3500);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [roomId, friendId]);

  const poker = snapshot?.poker;
  const blackjack = snapshot?.blackjack;

  return (
    <main className="min-h-[100dvh] bg-[#070b16] text-white px-3 sm:px-6 py-5 pb-12">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <button onClick={onExit} className="rounded-full bg-slate-800 px-4 py-2 flex items-center gap-2 text-sm font-bold">
            <ChevronLeft className="w-4 h-4" /> Back to Friends
          </button>
          <span className="flex items-center gap-2 text-cyan-300 text-xs sm:text-sm font-bold">
            <Eye className="w-4 h-4" /> WATCH MODE · READ ONLY
          </span>
        </div>
        <div className="glass-bubbly rounded-[28px] p-5 border border-cyan-400/20">
          <h1 className="text-xl sm:text-2xl font-extrabold">{snapshot?.room.name || 'Friend’s Live Game'}</h1>
          <p className="text-slate-400 text-sm mt-1">
            Watching {friendName} · No chips required · No betting or game controls
          </p>
        </div>
        {loading && <div className="text-center py-16 text-slate-300 flex items-center justify-center gap-2"><RefreshCw className="w-5 h-5 animate-spin" /> Loading game…</div>}
        {error && <div role="alert" className="rounded-2xl bg-rose-950/40 border border-rose-400/30 text-rose-200 p-4">{error}</div>}
        {poker && (
          <div className="space-y-4">
            <div className="rounded-[36px] border-[7px] border-amber-900/80 bg-gradient-to-b from-emerald-800 to-emerald-950 p-5 sm:p-10 shadow-2xl text-center">
              <p className="text-emerald-100/80 text-xs uppercase tracking-[0.2em] font-bold">Texas Hold’em · Hand #{poker.handNumber} · {poker.street}</p>
              <p className="text-amber-300 font-extrabold text-xl mt-3">Pot: {poker.pot.toLocaleString()} chips</p>
              <div className="flex gap-1.5 sm:gap-3 justify-center flex-wrap py-8">
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index}>
                    {poker.communityCards[index] ? <PlayingCard card={poker.communityCards[index]} size="board" /> :
                      <div className="w-11 h-16 sm:w-14 sm:h-20 rounded-lg border-2 border-emerald-400/20 bg-emerald-900/60" />}
                  </div>
                ))}
              </div>
              {poker.winners.length > 0 && (
                <p className="text-amber-200 font-bold">Winner: {poker.winners.map(w => `${w.username} — ${w.handDescription}`).join(', ')}</p>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {poker.seats.map(seat => (
                <div key={seat.userId} className={`rounded-2xl border p-3 ${seat.isCurrentTurn ? 'border-amber-400 bg-amber-950/30' : 'border-slate-700 bg-slate-900/80'}`}>
                  <div className="flex gap-2 items-center justify-between">
                    <p className="font-bold truncate">{seat.username}{seat.userId === friendId ? ' ★' : ''}</p>
                    {seat.isDealer && <span className="text-amber-300 text-xs">Dealer</span>}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{seat.chips.toLocaleString()} chips · {seat.folded ? 'Folded' : seat.lastAction || (seat.isCurrentTurn ? 'Thinking…' : 'Playing')}</p>
                  <div className="flex gap-1 mt-3">
                    {seat.cardCount > 0 && Array.from({ length: Math.min(2, seat.cardCount) }, (_, index) => (
                      <PlayingCard key={index} size="xs" card={seat.holeCards?.[index] || null} faceDown={!seat.holeCards?.[index]} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {blackjack && (
          <div className="space-y-4">
            <div className="rounded-[32px] border-[7px] border-amber-900/80 bg-gradient-to-b from-emerald-800 to-emerald-950 p-8 text-center">
              <p className="text-emerald-100 text-sm font-bold uppercase">Blackjack · Round #{blackjack.roundNumber} · {blackjack.phase.replaceAll('_', ' ')}</p>
              <p className="mt-4 mb-2 font-bold">Dealer {blackjack.dealerScore == null ? '' : `— ${blackjack.dealerScore}`}</p>
              <div className="flex justify-center gap-2">
                {blackjack.dealerCards.map((card, index) => <PlayingCard size="sm" key={index} card={card} />)}
                {Array.from({ length: blackjack.dealerHiddenCardCount }, (_, index) => <PlayingCard size="sm" key={index} faceDown />)}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {blackjack.seats.map(seat => (
                <div key={seat.userId} className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
                  <p className="font-bold">{seat.username}{seat.userId === friendId ? ' ★' : ''}</p>
                  <p className="text-xs text-slate-400 mb-3">{seat.tableChips.toLocaleString()} table chips</p>
                  {seat.hands.map(hand => (
                    <div key={hand.handIndex} className="flex gap-2 items-center mb-3 flex-wrap">
                      {hand.cards.map((card, index) => <PlayingCard size="sm" key={index} card={card} />)}
                      <span className="text-sm font-semibold">{hand.score} · {hand.outcome || (hand.isStood ? 'Stand' : '')}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        {!loading && !error && !poker && !blackjack && (
          <div className="text-center text-slate-400 py-12">Waiting for the next hand…</div>
        )}
        <p className="text-center text-xs text-slate-500">Updates automatically about every 3.5 seconds. Hidden cards stay hidden until showdown.</p>
      </div>
    </main>
  );
};
