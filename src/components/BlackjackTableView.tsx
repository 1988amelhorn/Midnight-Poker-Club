import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, Copy, Gauge, MessageSquare, Send, Settings, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useGameSocket } from '../context/GameSocketContext.tsx';
import { GAME_SPEED_CONFIG, getCardBlackjackValue, type GameSpeed } from '../shared/types.ts';
import {
  formatLastBlackjackHandResult,
  getBlackjackHandStatusSummary,
  type LastBlackjackRoundSummary,
} from '../shared/blackjackHelpers.ts';
import { PlayerAvatar } from '../utils/avatars.tsx';
import { PlayerCardModal } from './PlayerCardModal.tsx';
import { soundEngine } from '../utils/soundEngine.ts';
import { ChipStack } from './ChipStack.tsx';
import { PlayingCard } from './PlayingCard.tsx';

const BET_CHIPS = [25, 50, 100, 250, 500];

export const BlackjackTableView: React.FC<{
  roomId: string;
  onExit: () => void;
}> = ({ roomId, onExit }) => {
  const { user, refreshWallet } = useAuth();
  const {
    currentRoom,
    blackjackState,
    roomChat,
    actionError,
    clearActionError,
    subscribeRoom,
    sendBlackjackAction,
  } = useGameSocket();

  const [selectedBet, setSelectedBet] = useState(100);
  const [showChat, setShowChat] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [chatText, setChatText] = useState('');
  const [viewPlayerId, setViewPlayerId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastRoundSummary, setLastRoundSummary] = useState<LastBlackjackRoundSummary | null>(null);
  const prevPhaseRef = useRef<string>('');
  const prevDealerHiddenRef = useRef<number>(0);
  const lastSettledRoundRef = useRef<number>(0);

  const prefersReducedMotion =
    Boolean(user?.reducedAnimations) ||
    (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    setLastRoundSummary(null);
    lastSettledRoundRef.current = 0;
    subscribeRoom(roomId);
    return () => subscribeRoom(null);
  }, [roomId, subscribeRoom]);

  useEffect(() => {
    if (!blackjackState) return;
    if (prevDealerHiddenRef.current > 0 && blackjackState.dealerHiddenCardCount === 0) {
      if (soundEngine.shouldPlayOnce(`bj:flip:${blackjackState.roomId}:${blackjackState.roundNumber}`)) {
        soundEngine.playCardFlip();
      }
    }
    prevDealerHiddenRef.current = blackjackState.dealerHiddenCardCount;

    if (blackjackState.phase !== prevPhaseRef.current) {
      prevPhaseRef.current = blackjackState.phase;
      if (blackjackState.phase === 'player_turns' || blackjackState.phase === 'insurance') {
        if (soundEngine.shouldPlayOnce(`bj:deal:${blackjackState.roomId}:${blackjackState.roundNumber}`)) {
          soundEngine.playShuffle();
          setTimeout(() => soundEngine.playCardDeal(), 180);
        }
      } else if (blackjackState.phase === 'settled') {
        const mySeat = blackjackState.seats.find((s) => s.userId === user?.id);
        const won = mySeat?.hands.some((h) => h.outcome === 'win' || h.outcome === 'blackjack');
        if (won && soundEngine.shouldPlayOnce(`bj:win:${blackjackState.roomId}:${blackjackState.roundNumber}`)) {
          soundEngine.playHandWin();
        }
      }
    }

    if (blackjackState.phase === 'settled' && blackjackState.roundNumber > lastSettledRoundRef.current) {
      const seat = blackjackState.seats.find((s) => s.userId === user?.id);
      const formatted = formatLastBlackjackHandResult({
        hands: seat?.hands,
        dealerScore: blackjackState.dealerScore,
      });
      if (formatted) {
        lastSettledRoundRef.current = blackjackState.roundNumber;
        setLastRoundSummary(formatted);
      }
    }
  }, [blackjackState, user?.id]);

  const mySeat = blackjackState?.seats.find((s) => s.userId === user?.id);
  const handStatusSummary = useMemo(
    () =>
      getBlackjackHandStatusSummary({
        hands: mySeat?.hands,
        activeHandIndex: mySeat?.activeHandIndex ?? 0,
        dealerScore: blackjackState?.dealerScore,
        dealerHiddenCardCount: blackjackState?.dealerHiddenCardCount ?? 0,
      }),
    [mySeat?.hands, mySeat?.activeHandIndex, blackjackState?.dealerScore, blackjackState?.dealerHiddenCardCount]
  );
  const isMyTurn = blackjackState?.phase === 'player_turns' && blackjackState.currentTurnUserId === user?.id;
  const activeHand = isMyTurn && mySeat ? mySeat.hands[mySeat.activeHandIndex] : null;
  const isHost = currentRoom?.hostId === user?.id;
  const activeSpeed: GameSpeed = blackjackState?.gameSpeed || 'normal';
  const speedConfig = GAME_SPEED_CONFIG[activeSpeed];
  const dealStaggerSec = Math.min(0.4, (speedConfig.dealCardMs / 1000) * 0.25);

  const canSplit =
    Boolean(activeHand) &&
    activeHand!.cards.length === 2 &&
    (mySeat?.hands.length ?? 0) < 4 &&
    getCardBlackjackValue(activeHand!.cards[0]) === getCardBlackjackValue(activeHand!.cards[1]) &&
    (mySeat?.tableChips ?? 0) >= activeHand!.bet;

  const canDouble =
    Boolean(activeHand) &&
    activeHand!.cards.length === 2 &&
    !activeHand!.isSplitAce &&
    (mySeat?.tableChips ?? 0) >= activeHand!.bet;

  const handleLeave = async () => {
    soundEngine.unlock();
    try {
      await apiFetch(`/api/rooms/${roomId}/leave`, { method: 'POST' });
      await refreshWallet();
    } catch {
      // ignore
    }
    onExit();
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    try {
      await apiFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ channelType: 'room', channelId: roomId, message: chatText.trim() }),
      });
      setChatText('');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Message failed');
    }
  };

  return (
    <div
      onClick={() => soundEngine.unlock()}
      className="relative flex flex-col h-[100dvh] w-full overflow-hidden bg-[#060911] text-slate-100"
    >
      {/* Top Bar */}
      <header className="relative z-20 flex items-center justify-between gap-2 px-3 sm:px-5 py-2.5 border-b border-sky-400/20 bg-[#080d1e]/90 backdrop-blur-xl shadow-[0_6px_28px_rgba(0,0,0,0.55)]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={handleLeave}
            className="btn-glossy btn-glossy-dark inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full text-slate-200 shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-display font-bold text-white truncate">
                {currentRoom?.name || 'Blackjack'}
              </h1>
              {currentRoom?.code && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(currentRoom.code);
                    setNotice(`Copied table code ${currentRoom.code}`);
                  }}
                  className="hidden sm:inline-flex items-center gap-1 rounded-full bg-slate-900/90 border border-cyan-400/35 px-2.5 py-0.5 font-mono text-[11px] text-cyan-300 shrink-0"
                >
                  {currentRoom.code} <Copy className="w-3 h-3" />
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400 font-mono tabular-nums truncate">
              Round #{blackjackState?.roundNumber ?? 0} · Min {blackjackState?.minBet ?? 25} / Max {blackjackState?.maxBet ?? 1000}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Synchronized Game Speed Cue */}
          <div className="hidden md:flex items-center gap-1 rounded-full bg-slate-950/90 border border-sky-400/25 p-1 shadow-inner">
            <Gauge className="w-3.5 h-3.5 text-cyan-400 ml-2 mr-0.5" />
            {(['relaxed', 'normal', 'fast'] as GameSpeed[]).map((sp) => (
              <button
                key={sp}
                type="button"
                disabled={!isHost}
                onClick={() =>
                  void apiFetch(`/api/rooms/${roomId}/speed`, {
                    method: 'POST',
                    body: JSON.stringify({ speed: sp }),
                  })
                }
                title={isHost ? `Set table pacing to ${sp}` : `Host selected ${activeSpeed} speed`}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold capitalize transition ${
                  activeSpeed === sp
                    ? sp === 'relaxed'
                      ? 'bg-emerald-500/30 text-emerald-200'
                      : sp === 'fast'
                        ? 'bg-purple-500/35 text-purple-200'
                        : 'bg-cyan-500/30 text-cyan-100'
                    : 'text-slate-500 hover:text-slate-300'
                } ${!isHost ? 'cursor-default' : ''}`}
              >
                {sp}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowChat((v) => !v)}
            className={`btn-glossy inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold min-h-[40px] ${
              showChat ? 'btn-glossy-blue border-sky-300/60 text-white' : 'btn-glossy-dark text-slate-100'
            }`}
          >
            <MessageSquare className={`w-4 h-4 ${showChat ? 'text-white' : 'text-cyan-400'}`} />
            <span className="hidden sm:inline">Chat</span>
          </button>
          <button
            type="button"
            onClick={() => setShowRules(true)}
            className="btn-glossy btn-glossy-dark inline-flex items-center justify-center w-10 h-10 rounded-full text-slate-200"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {(actionError || notice) && (
        <div className="relative z-30 mx-auto mt-2 px-4 py-1.5 rounded-xl bg-amber-500/15 border border-amber-400/50 text-xs text-amber-200 flex items-center gap-3">
          <span>{actionError || notice}</span>
          <button
            type="button"
            onClick={() => {
              clearActionError();
              setNotice(null);
            }}
            className="font-bold text-amber-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Blackjack Felt Table */}
      <main className="relative flex-1 min-h-0 flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
        <div className="relative w-full max-w-4xl min-h-[360px] sm:min-h-[430px] rounded-[34px] sm:rounded-[52px] p-2.5 sm:p-4 casino-rail">
          <div className="relative w-full h-full min-h-[340px] sm:min-h-[405px] rounded-[26px] sm:rounded-[44px] casino-felt flex flex-col items-center justify-between py-4 px-2.5 sm:px-6">
            {/* Dealer Zone */}
            <div className="flex flex-col items-center gap-1.5 sm:gap-2">
              <div className="flex items-center gap-2">
                <span className="px-3 py-0.5 rounded-full bg-black/55 border border-slate-700/80 text-xs font-display font-bold tracking-wide text-slate-200">
                  Dealer
                </span>
                <span className="md:hidden text-[10px] font-mono uppercase tracking-wider text-emerald-200/70">
                  {activeSpeed}
                </span>
              </div>
              <div className="flex items-center justify-center gap-1.5 sm:gap-2 min-h-[72px] sm:min-h-[88px]">
                {blackjackState && blackjackState.dealerCards.length > 0 ? (
                  <>
                    {blackjackState.dealerCards.map((c, idx) => (
                      <PlayingCard
                        key={`d-${blackjackState.roundNumber}-${idx}`}
                        card={c}
                        size="hole"
                        dealDelaySec={idx * dealStaggerSec}
                        reducedMotion={prefersReducedMotion}
                      />
                    ))}
                    {blackjackState.dealerHiddenCardCount > 0 && (
                      <PlayingCard
                        key={`d-${blackjackState.roundNumber}-1`}
                        faceDown
                        size="hole"
                        dealDelaySec={dealStaggerSec}
                        reducedMotion={prefersReducedMotion}
                      />
                    )}
                  </>
                ) : (
                  <p className="text-xs text-emerald-200/60">Place your bet to deal cards</p>
                )}
              </div>
              {blackjackState?.dealerScore !== null && blackjackState?.dealerScore !== undefined && (
                <span className="px-2.5 py-0.5 rounded-md bg-black/70 border border-emerald-400/40 font-mono text-xs font-bold text-white tabular-nums">
                  {blackjackState.dealerHiddenCardCount > 0 ? `${blackjackState.dealerScore} + ?` : blackjackState.dealerScore}
                </span>
              )}
            </div>

            {/* Felt Rule Inscription */}
            <div className="text-center my-2 pointer-events-none select-none">
              <p className="font-display font-extrabold tracking-[0.24em] text-[10px] sm:text-xs text-cyan-300/45 uppercase mb-1">
                MIDNIGHT POKER CLUB
              </p>
              <p className="font-display font-bold tracking-[0.18em] text-[10px] sm:text-xs text-amber-200/55 uppercase">
                BLACKJACK PAYS 3 TO 2 · INSURANCE PAYS 2 TO 1
              </p>
              <p className="font-display text-[10px] tracking-[0.15em] text-emerald-200/45 uppercase mt-0.5">
                DEALER STANDS ON ALL 17s
              </p>
            </div>

            {/* Player Seats (1-7) */}
            <div className="w-full flex flex-wrap items-end justify-center gap-2.5 sm:gap-5">
              {(blackjackState?.seats ?? []).map((seat) => {
                const isMe = seat.userId === user?.id;
                const anyWin = seat.hands.some((h) => h.outcome === 'win' || h.outcome === 'blackjack');
                return (
                  <motion.div
                    key={seat.userId}
                    data-testid={`bj-seat-${seat.seatIndex}`}
                    animate={anyWin ? { scale: [1, 1.02, 1] } : undefined}
                    className={`flex flex-col items-center gap-2 rounded-[24px] sm:rounded-[26px] border-2 p-2.5 sm:p-3 min-w-[132px] sm:min-w-[174px] max-w-full backdrop-blur-md shadow-xl transition-all ${
                      anyWin
                        ? 'border-amber-400 bg-amber-950/55 animate-winner-spotlight'
                        : seat.isCurrentTurn
                          ? 'border-sky-400 bg-sky-950/45 animate-turn-ring'
                          : isMe
                            ? 'border-emerald-400/65 bg-black/45'
                            : 'border-slate-700/70 bg-black/40'
                    }`}
                  >
                    {/* Split / Single Hands */}
                    {seat.hands.length > 0 && (
                      <div className="flex flex-wrap justify-center gap-2 sm:gap-2.5">
                        {seat.hands.map((hand, hIdx) => {
                          const isCurrentSplit = seat.isCurrentTurn && seat.activeHandIndex === hIdx;
                          return (
                            <div
                              key={hIdx}
                              className={`flex flex-col items-center gap-1.5 rounded-xl p-1 ${
                                isCurrentSplit ? 'ring-2 ring-sky-400 bg-sky-500/10' : ''
                              }`}
                            >
                              <div className="flex -space-x-2">
                                {hand.cards.map((c, cIdx) => (
                                  <PlayingCard
                                    key={`${blackjackState?.roundNumber}-${seat.userId}-${hIdx}-${cIdx}`}
                                    card={c}
                                    size={seat.hands.length > 1 || hand.cards.length >= 4 ? 'xs' : 'sm'}
                                    highlighted={hand.outcome === 'win' || hand.outcome === 'blackjack'}
                                    dimmed={hand.isBust}
                                    dealDelaySec={cIdx * dealStaggerSec}
                                    reducedMotion={prefersReducedMotion}
                                  />
                                ))}
                              </div>
                              <div className="flex items-center gap-1.5 text-[11px] font-mono">
                                {hand.cards.length > 0 && (
                                  <span className={`px-1.5 py-0.5 rounded font-bold ${
                                    hand.isBust
                                      ? 'bg-rose-600/80 text-white'
                                      : hand.isBlackjack
                                        ? 'bg-amber-400 text-slate-950'
                                        : 'bg-slate-900 text-white'
                                  }`}>
                                    {hand.isBlackjack ? 'BJ 21' : hand.isBust ? `BUST ${hand.score}` : hand.score}
                                  </span>
                                )}
                                <span className="text-amber-300 font-bold">{hand.bet}</span>
                              </div>
                              {hand.outcome && (
                                <span className={`text-[10px] font-display font-bold uppercase ${
                                  hand.outcome === 'blackjack' || hand.outcome === 'win'
                                    ? 'text-emerald-300'
                                    : hand.outcome === 'push'
                                      ? 'text-sky-300'
                                      : 'text-rose-400'
                                }`}>
                                  {hand.outcome === 'blackjack'
                                    ? `Blackjack +${hand.payout - hand.bet}`
                                    : hand.outcome === 'win'
                                      ? `Win +${hand.payout - hand.bet}`
                                      : hand.outcome === 'push'
                                        ? 'Push'
                                        : hand.outcome === 'bust'
                                          ? 'Bust'
                                          : 'Lose'}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Player Plate */}
                    <div className="flex items-center gap-2 max-w-full">
                      <button type="button" aria-label={`View ${seat.username} profile`} onClick={(event) => { event.stopPropagation(); setViewPlayerId(seat.userId); }} className="shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
                        <PlayerAvatar avatarId={seat.avatarId} username={seat.username} size="sm" />
                      </button>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{isMe ? 'You' : seat.username}</p>
                        <p className="font-mono text-xs font-bold text-amber-300 tabular-nums">
                          {seat.tableChips.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Collapsible Chat */}
        {showChat && (
          <aside className="glass-bubbly absolute right-3 top-3 bottom-3 w-72 z-30 rounded-[28px] p-3.5 flex flex-col">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h2 className="text-sm font-display font-bold text-white">Table Chat</h2>
              <button type="button" onClick={() => setShowChat(false)} className="text-xs text-slate-400 hover:text-white">
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 py-2">
              {roomChat.map((m) => (
                <div key={m.id} className="text-xs">
                  <span className="font-semibold text-cyan-300">{m.senderUsername}: </span>
                  <span className="text-slate-200">{m.message}</span>
                </div>
              ))}
            </div>
            <form onSubmit={handleSendChat} className="flex gap-1.5 pt-1.5">
              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Type message..."
                className="input-bubbly flex-1 rounded-full px-3.5 py-2 text-xs text-white"
              />
              <button type="submit" className="btn-glossy btn-glossy-blue w-9 h-9 rounded-full text-white flex items-center justify-center">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </aside>
        )}
      </main>

      {/* Bottom HUD Row: Current Blackjack Hand Status + Bottom-Right Last Hand Box */}
      <section
        aria-label="Blackjack Hand Status and Last Hand Result"
        className="relative z-20 px-2.5 sm:px-6 pb-2 pt-0.5 shrink-0"
      >
        <div className="max-w-4xl mx-auto flex items-stretch justify-between gap-2 sm:gap-3">
          {/* Hand Status Panel */}
          <div
            data-testid="bj-hand-panel"
            className="glass-bubbly flex-1 min-w-0 rounded-2xl sm:rounded-3xl px-3 py-1.5 sm:px-4 sm:py-2 border border-sky-400/35 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-3"
          >
            <div className="min-w-0">
              <p className="text-[11px] sm:text-xs font-display font-bold text-white truncate">
                <span className="text-sky-300">Your Hand:</span> {handStatusSummary.handText}
              </p>
              {handStatusSummary.dealerText && (
                <p className="text-[10px] sm:text-[11px] font-mono text-slate-400 truncate">
                  {handStatusSummary.dealerText}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] sm:text-[11px] text-slate-400 font-semibold">Status:</span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] sm:text-xs font-display font-extrabold border ${
                  handStatusSummary.tone === 'gold'
                    ? 'bg-amber-400/20 border-amber-300/60 text-amber-300'
                    : handStatusSummary.tone === 'rose'
                      ? 'bg-rose-500/20 border-rose-400/60 text-rose-300'
                      : handStatusSummary.tone === 'cyan'
                        ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                        : handStatusSummary.tone === 'emerald'
                          ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                          : 'bg-slate-800/80 border-slate-600/60 text-slate-300'
                }`}
              >
                {handStatusSummary.statusText}
              </span>
            </div>
          </div>

          {/* Persistent Bottom-Right Last Hand Box */}
          <div
            data-testid="bj-last-hand-box"
            className="glass-bubbly w-[154px] sm:w-[232px] shrink-0 rounded-2xl sm:rounded-3xl px-3 py-1.5 sm:px-4 sm:py-2 border border-amber-400/40 flex flex-col justify-center text-right sm:text-left"
          >
            <p className="text-[9px] sm:text-[10px] font-display font-extrabold uppercase tracking-wider text-amber-300">
              Last Hand
            </p>
            {lastRoundSummary ? (
              <>
                <p className="text-[11px] sm:text-xs font-bold text-white truncate">
                  {lastRoundSummary.headline}
                </p>
                <p
                  className={`text-[10px] sm:text-[11px] font-medium truncate ${
                    lastRoundSummary.tone === 'gold'
                      ? 'text-amber-300'
                      : lastRoundSummary.tone === 'emerald'
                        ? 'text-emerald-300'
                        : lastRoundSummary.tone === 'sky'
                          ? 'text-sky-300'
                          : 'text-rose-300'
                  }`}
                >
                  {lastRoundSummary.subtitle}
                </p>
              </>
            ) : (
              <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">
                Waiting for first round
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Bottom Action Controls */}
      <footer className="relative z-20 border-t border-sky-400/20 bg-[#080d1e]/92 backdrop-blur-xl px-3 sm:px-6 py-2.5 sm:py-3 shadow-[0_-8px_28px_rgba(0,0,0,0.55)]">
        <div className="max-w-2xl mx-auto">
          {/* Betting Phase */}
          {(blackjackState?.phase === 'betting' || blackjackState?.phase === 'settled') && mySeat && !mySeat.betPlaced && (
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center justify-center gap-2">
                {BET_CHIPS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => {
                      soundEngine.playChipClick();
                      setSelectedBet(Math.min(mySeat.tableChips, amt));
                    }}
                    className={`btn-glossy px-4 py-2 rounded-full border font-mono text-xs font-bold transition min-h-[40px] ${
                      selectedBet === amt
                        ? 'btn-glossy-gold text-slate-950 border-amber-200/80'
                        : 'btn-glossy-dark text-slate-200'
                    }`}
                  >
                    {amt}
                  </button>
                ))}
                <ChipStack amount={selectedBet} label="Bet" size="sm" />
              </div>
              <button
                type="button"
                disabled={mySeat.tableChips < (blackjackState?.minBet ?? 25)}
                onClick={() => {
                  soundEngine.playChipSlide();
                  void sendBlackjackAction('place_bet', selectedBet);
                }}
                className="btn-glossy btn-glossy-green w-full min-h-[48px] rounded-full border border-emerald-200/50 text-slate-950 font-display font-extrabold text-sm disabled:opacity-40"
              >
                Place Bet ({selectedBet.toLocaleString()}) &amp; Deal
              </button>
            </div>
          )}

          {/* Insurance Phase */}
          {blackjackState?.phase === 'insurance' && mySeat && !mySeat.insuranceDecided && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-amber-200">
                <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0" />
                <span>
                  Dealer shows an Ace. Take Insurance (2:1) for {Math.floor((mySeat.hands[0]?.bet ?? 0) / 2)} chips?
                </span>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => void sendBlackjackAction('insurance_decline')}
                  className="btn-glossy btn-glossy-dark flex-1 sm:flex-none px-5 py-2.5 rounded-full text-xs font-bold text-white min-h-[44px]"
                >
                  No Insurance
                </button>
                <button
                  type="button"
                  onClick={() => void sendBlackjackAction('insurance_accept')}
                  className="btn-glossy btn-glossy-gold flex-1 sm:flex-none px-5 py-2.5 rounded-full text-slate-950 text-xs font-bold min-h-[44px]"
                >
                  Buy Insurance
                </button>
              </div>
            </div>
          )}

          {/* Player Turn Phase */}
          {isMyTurn && (
            <div className={`grid gap-2.5 ${canSplit ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <button
                type="button"
                onClick={() => {
                  soundEngine.playCardDeal();
                  void sendBlackjackAction('hit');
                }}
                className="btn-glossy btn-glossy-green min-h-[48px] rounded-full border border-emerald-200/50 text-slate-950 font-display font-extrabold text-sm"
              >
                Hit
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.playCheck();
                  void sendBlackjackAction('stand');
                }}
                className="btn-glossy btn-glossy-blue min-h-[48px] rounded-full border border-sky-300/50 text-white font-display font-bold text-sm"
              >
                Stand
              </button>
              <button
                type="button"
                disabled={!canDouble}
                onClick={() => {
                  soundEngine.playChipClick();
                  void sendBlackjackAction('double');
                }}
                className="btn-glossy btn-glossy-purple min-h-[48px] rounded-full border border-purple-300/50 text-white font-display font-bold text-sm disabled:opacity-40"
              >
                Double
              </button>
              {canSplit && (
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playChipClick();
                    void sendBlackjackAction('split');
                  }}
                  className="btn-glossy btn-glossy-gold min-h-[48px] rounded-full border border-amber-200/60 text-slate-950 font-display font-extrabold text-sm"
                >
                  Split
                </button>
              )}
            </div>
          )}

          {/* Waiting Status */}
          {blackjackState?.phase === 'settled' && mySeat?.betPlaced && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-300">Round settled. Ready for next deal.</p>
              <button
                type="button"
                onClick={() => void sendBlackjackAction('place_bet', selectedBet)}
                className="btn-glossy btn-glossy-green px-5 py-2.5 rounded-full text-slate-950 font-display font-extrabold text-xs min-h-[44px]"
              >
                Re-Bet {selectedBet}
              </button>
            </div>
          )}
        </div>
      </footer>

      {/* Rules & Speed Modal */}
      {showRules && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="glass-bubbly w-full max-w-md rounded-[32px] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-display font-bold text-white">Blackjack Rules &amp; Speed</h3>
              <button type="button" onClick={() => setShowRules(false)} className="text-sm text-slate-400 hover:text-white">
                Close
              </button>
            </div>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li>• Blackjack pays 3:2; Insurance pays 2:1</li>
              <li>• Dealer stands on all 17s (including soft 17)</li>
              <li>• Dealer peeks for Blackjack on Ace or 10-value upcard</li>
              <li>• Double after split allowed; up to 4 hands</li>
              <li>• Split Aces receive one card each</li>
            </ul>
            {isHost && (
              <div>
                <p className="text-xs font-semibold text-slate-300 mb-2">Table Speed</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['relaxed', 'normal', 'fast'] as GameSpeed[]).map((sp) => (
                    <button
                      key={sp}
                      type="button"
                      onClick={() =>
                        void apiFetch(`/api/rooms/${roomId}/speed`, {
                          method: 'POST',
                          body: JSON.stringify({ speed: sp }),
                        })
                      }
                      className={`btn-glossy py-2 rounded-full border text-xs font-semibold capitalize ${
                        blackjackState?.gameSpeed === sp
                          ? 'btn-glossy-blue border-cyan-300/60 text-white'
                          : 'btn-glossy-dark text-slate-400'
                      }`}
                    >
                      {sp}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {viewPlayerId && <PlayerCardModal playerId={viewPlayerId} onClose={() => setViewPlayerId(null)} />}
    </div>
  );
};
