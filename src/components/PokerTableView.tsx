import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bot,
  ChevronLeft,
  Copy,
  Flag,
  Gauge,
  MessageSquare,
  Plus,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { TableBankroll } from './TableBankroll.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useGameSocket } from '../context/GameSocketContext.tsx';
import {
  GAME_SPEED_CONFIG,
  type BotDifficulty,
  type Card,
  type GameSpeed,
  type PokerSeatPublic,
} from '../shared/types.ts';
import {
  classifyLiveHoldemHand,
  formatLastHoldemHandResult,
  type LastHoldemHandSummary,
} from '../shared/pokerEvaluator.ts';
import { PlayerAvatar } from '../utils/avatars.tsx';
import { PlayerCardModal } from './PlayerCardModal.tsx';
import { soundEngine } from '../utils/soundEngine.ts';
import { ChipStack } from './ChipStack.tsx';
import { PlayingCard } from './PlayingCard.tsx';

const QUICK_EMOTES = ['🔥', '👏', '😎', '😂', '👀', '🍀'] as const;

// Seat positions (% left, % top) around the oval table relative to local player at bottom center (index 0).
// Kept well inside [15..85]% horizontal and [11..84]% vertical so cards and plates never clip or overlap on 375px screens.
const SEAT_POSITIONS_BY_COUNT: Record<number, Array<{ x: number; y: number }>> = {
  2: [{ x: 50, y: 84 }, { x: 50, y: 12 }],
  3: [{ x: 50, y: 84 }, { x: 18, y: 24 }, { x: 82, y: 24 }],
  4: [{ x: 50, y: 84 }, { x: 16, y: 48 }, { x: 50, y: 12 }, { x: 84, y: 48 }],
  5: [{ x: 50, y: 84 }, { x: 16, y: 60 }, { x: 23, y: 15 }, { x: 77, y: 15 }, { x: 84, y: 60 }],
  6: [{ x: 50, y: 84 }, { x: 16, y: 61 }, { x: 18, y: 21 }, { x: 50, y: 12 }, { x: 82, y: 21 }, { x: 84, y: 61 }],
  7: [{ x: 50, y: 84 }, { x: 16, y: 66 }, { x: 16, y: 31 }, { x: 36, y: 12 }, { x: 64, y: 12 }, { x: 84, y: 31 }, { x: 84, y: 66 }],
  8: [{ x: 50, y: 84 }, { x: 18, y: 71 }, { x: 15, y: 43 }, { x: 23, y: 15 }, { x: 50, y: 11 }, { x: 77, y: 15 }, { x: 85, y: 43 }, { x: 82, y: 71 }],
  9: [{ x: 50, y: 84 }, { x: 19, y: 72 }, { x: 15, y: 48 }, { x: 18, y: 20 }, { x: 38, y: 11 }, { x: 62, y: 11 }, { x: 82, y: 20 }, { x: 85, y: 48 }, { x: 81, y: 72 }],
};

function cardsEqual(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

interface FlyingChip {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  amount: number;
  variant: 'bet' | 'payout';
}

const SPEED_CYCLE: GameSpeed[] = ['relaxed', 'normal', 'fast'];

export const PokerTableView: React.FC<{
  roomId: string;
  onExit: () => void;
  onOpenTournamentInfo?: (tournamentId: string) => void;
}> = ({ roomId, onExit, onOpenTournamentInfo }) => {
  const { user, refreshWallet, updateProfile } = useAuth();
  const {
    currentRoom,
    pokerState,
    currentTournament,
    roomChat,
    actionError,
    clearActionError,
    subscribeRoom,
    subscribeTournament,
    sendPokerAction,
  } = useGameSocket();

  const [betAmount, setBetAmount] = useState(100);
  const [showOddsDrawer, setShowOddsDrawer] = useState(false);
  const [showChatDrawer, setShowChatDrawer] = useState(false);
  const [showQuickReactions, setShowQuickReactions] = useState(false);
  const [sendingReaction, setSendingReaction] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [reportTarget, setReportTarget] = useState<PokerSeatPublic | null>(null);
  const [reportReason, setReportReason] = useState('Collusion or suspicious play');
  const [chatText, setChatText] = useState('');
  const [viewPlayerId, setViewPlayerId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [revealedBoardCount, setRevealedBoardCount] = useState(0);
  const [shufflingHand, setShufflingHand] = useState(false);
  const [flyingChips, setFlyingChips] = useState<FlyingChip[]>([]);
  const [lastHandSummary, setLastHandSummary] = useState<LastHoldemHandSummary | null>(null);
  const [lastReplay, setLastReplay] = useState<{
    handNumber: number;
    communityCards: Card[];
    seats: Array<{ userId: string; username: string; revealedCards: Card[] | null; folded: boolean }>;
    headline: string; subtitle: string;
  } | null>(null);
  const [showReplay, setShowReplay] = useState(false);
  const [replayStep, setReplayStep] = useState(0);

  const prevHandRef = useRef(0);
  const prevActionSeqRef = useRef(0);
  const prevWinnerKeyRef = useRef('');
  const prevBetsRef = useRef<Map<string, number>>(new Map());
  const prevStreetRef = useRef<string>('waiting');
  const prevShowdownFlipKeyRef = useRef('');
  const lastRecordedWinnerHandRef = useRef(0);

  const prefersReducedMotion =
    Boolean(user?.reducedAnimations) ||
    (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    setLastHandSummary(null);
    setLastReplay(null);
    setShowReplay(false);
    lastRecordedWinnerHandRef.current = 0;
    subscribeRoom(roomId);
    return () => subscribeRoom(null);
  }, [roomId, subscribeRoom]);

  useEffect(() => {
    if (currentRoom?.tournamentId) {
      subscribeTournament(currentRoom.tournamentId);
    }
  }, [currentRoom?.tournamentId, subscribeTournament]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (pokerState?.legalActions) {
      setBetAmount(pokerState.legalActions.minBetOrRaiseTo);
    }
  }, [pokerState?.legalActions?.minBetOrRaiseTo, pokerState?.currentTurnUserId]);

  // Paced dealing, shuffling, and community card reveal driven by GAME_SPEED_CONFIG
  useEffect(() => {
    if (!pokerState) return;
    const speed = GAME_SPEED_CONFIG[pokerState.gameSpeed || 'normal'];

    if (pokerState.handNumber > prevHandRef.current && pokerState.street !== 'waiting') {
      prevHandRef.current = pokerState.handNumber;
      setRevealedBoardCount(0);
      setShufflingHand(true);
      const tShuffle = setTimeout(() => setShufflingHand(false), prefersReducedMotion ? 100 : 750);

      if (soundEngine.shouldPlayOnce(`deal:${pokerState.roomId}:${pokerState.handNumber}`)) {
        soundEngine.playShuffle();
        const seatCount = Math.max(2, pokerState.seats.length);
        for (let i = 0; i < Math.min(6, seatCount * 2); i++) {
          setTimeout(() => soundEngine.playCardDeal(), 240 + i * Math.min(450, speed.dealCardMs * 0.4));
        }
      }
      return () => clearTimeout(tShuffle);
    }
  }, [pokerState?.handNumber, pokerState?.street, pokerState?.roomId, pokerState?.gameSpeed, pokerState?.seats.length, prefersReducedMotion]);

  // Paced street-by-street community card presentation (never jumps flop -> river instantly)
  useEffect(() => {
    if (!pokerState) return;
    const speed = GAME_SPEED_CONFIG[pokerState.gameSpeed || 'normal'];
    const targetCount = pokerState.communityCards.length;

    if (targetCount === 0) {
      setRevealedBoardCount(0);
      return;
    }

    if (targetCount > revealedBoardCount) {
      let delayMs = speed.revealFlopMs;
      if (revealedBoardCount >= 1 && revealedBoardCount < 3) {
        delayMs = Math.min(350, speed.dealCardMs * 0.45);
      } else if (revealedBoardCount === 3) {
        delayMs = speed.revealTurnMs;
      } else if (revealedBoardCount === 4) {
        delayMs = speed.revealRiverMs;
      }

      const timer = setTimeout(() => {
        setRevealedBoardCount((prev) => {
          const next = Math.min(targetCount, prev + 1);
          if (soundEngine.shouldPlayOnce(`board:${pokerState.roomId}:${pokerState.handNumber}:${next}`)) {
            soundEngine.playCardFlip();
          }
          return next;
        });
      }, prefersReducedMotion ? 40 : delayMs);

      return () => clearTimeout(timer);
    }
  }, [pokerState?.communityCards.length, revealedBoardCount, pokerState?.gameSpeed, pokerState?.roomId, pokerState?.handNumber, prefersReducedMotion]);

  // Action & Winner Spotlight sound effects (with reconnect deduplication)
  useEffect(() => {
    if (!pokerState) return;
    const lastLog = pokerState.actionLog[pokerState.actionLog.length - 1];
    if (lastLog && lastLog.seq > prevActionSeqRef.current) {
      prevActionSeqRef.current = lastLog.seq;
      if (soundEngine.shouldPlayOnce(`act:${pokerState.roomId}:${lastLog.seq}`)) {
        const txt = lastLog.text.toLowerCase();
        if (txt.includes('fold')) soundEngine.playFold();
        else if (txt.includes('check')) soundEngine.playCheck();
        else if (txt.includes('bet') || txt.includes('raise') || txt.includes('call') || txt.includes('all-in')) {
          soundEngine.playChipClick();
        }
      }
    }

    if (pokerState.street === 'showdown' && pokerState.winners.length > 0 && revealedBoardCount >= pokerState.communityCards.length) {
      const wKey = `${pokerState.roomId}:${pokerState.handNumber}`;
      if (wKey !== prevWinnerKeyRef.current) {
        prevWinnerKeyRef.current = wKey;
        if (soundEngine.shouldPlayOnce(`win:${wKey}`)) {
          soundEngine.playHandWin();
        }
      }
    }
  }, [pokerState, revealedBoardCount]);

  // Turn countdown warning sound at <= 5s
  const turnSecondsLeft = useMemo(() => {
    if (!pokerState?.turnExpiresAt) return null;
    return Math.max(0, Math.ceil((pokerState.turnExpiresAt - nowMs) / 1000));
  }, [pokerState?.turnExpiresAt, nowMs]);

  useEffect(() => {
    if (
      pokerState &&
      pokerState.currentTurnUserId === user?.id &&
      turnSecondsLeft !== null &&
      turnSecondsLeft > 0 &&
      turnSecondsLeft <= 5
    ) {
      if (soundEngine.shouldPlayOnce(`warn:${pokerState.handNumber}:${pokerState.stateVersion}:${turnSecondsLeft}`)) {
        soundEngine.playTurnWarning();
      }
    }
  }, [turnSecondsLeft, pokerState, user?.id]);

  // Rotate seats so current user is always index 0 (bottom center)
  const arrangedSeats = useMemo(() => {
    if (!pokerState) return [];
    const seats = pokerState.seats;
    const myIdx = seats.findIndex((s) => s.userId === user?.id);
    if (myIdx === -1) return seats;
    return [...seats.slice(myIdx), ...seats.slice(0, myIdx)];
  }, [pokerState, user?.id]);

  const positions = SEAT_POSITIONS_BY_COUNT[Math.max(2, Math.min(9, arrangedSeats.length))] || SEAT_POSITIONS_BY_COUNT[6];
  const isHost = currentRoom?.hostId === user?.id;
  const mySeat = pokerState?.seats.find((s) => s.userId === user?.id);
  const legal = pokerState?.legalActions;
  const isMyTurn = pokerState?.currentTurnUserId === user?.id && Boolean(legal);

  // Free the table and action controls as soon as it's this player's turn.
  // Reactions are decorative chat events, never poker actions or chip bets.
  useEffect(() => {
    if (isMyTurn) {
      setShowChatDrawer(false);
      setShowQuickReactions(false);
    }
  }, [isMyTurn]);
  const showdownReady = pokerState?.street === 'showdown' && revealedBoardCount >= (pokerState?.communityCards.length ?? 0);
  const primaryWinner = showdownReady ? pokerState?.winners?.[0] ?? null : null;

  // Persist the most recently completed hand winner until the next hand finishes
  useEffect(() => {
    if (!pokerState || !showdownReady || pokerState.winners.length === 0) return;
    if (pokerState.handNumber > lastRecordedWinnerHandRef.current) {
      lastRecordedWinnerHandRef.current = pokerState.handNumber;
      const formatted = formatLastHoldemHandResult(pokerState.winners);
      if (formatted) {
        setLastHandSummary(formatted);
        // Capture only cards revealed by the server's player-specific public
        // state; never store opponents' unrevealed hole cards for replay.
        setLastReplay({
          handNumber: pokerState.handNumber,
          communityCards: [...pokerState.communityCards],
          seats: pokerState.seats.map((s) => ({
            userId: s.userId, username: s.username, folded: s.folded,
            revealedCards: s.holeCards ? [...s.holeCards] : null,
          })),
          headline: formatted.headline, subtitle: formatted.subtitle,
        });
      }
    }
  }, [pokerState, showdownReady]);

  useEffect(() => {
    if (!showReplay || prefersReducedMotion) return;
    const timer = setInterval(() => setReplayStep((n) => Math.min(5, n + 1)), 620);
    return () => clearInterval(timer);
  }, [showReplay, prefersReducedMotion]);

  const liveHandSummary = useMemo(() => {
    const visibleBoard = (pokerState?.communityCards ?? []).slice(0, revealedBoardCount);
    return classifyLiveHoldemHand({
      holeCards: mySeat?.holeCards,
      visibleBoard,
      serverHandStrength: pokerState?.handStrength,
      totalServerBoardCount: pokerState?.communityCards.length ?? 0,
      allowProbabilityAssist: Boolean(pokerState?.allowProbabilityAssist),
      folded: Boolean(mySeat?.folded),
    });
  }, [
    mySeat?.holeCards,
    mySeat?.folded,
    pokerState?.communityCards,
    pokerState?.handStrength,
    pokerState?.allowProbabilityAssist,
    revealedBoardCount,
  ]);

  const winningCardSet = useMemo(() => {
    const cards: Card[] = [];
    if (!showdownReady) return cards;
    for (const w of pokerState?.winners ?? []) {
      cards.push(...(w.bestFiveCards || []));
    }
    return cards;
  }, [pokerState?.winners, showdownReady]);

  // Smooth chip movements from player seats into the center pot on bets/raises/calls/sweeps
  useEffect(() => {
    if (!pokerState) return;
    const spawned: FlyingChip[] = [];
    const streetChanged = prevStreetRef.current !== pokerState.street && pokerState.street !== 'waiting';

    arrangedSeats.forEach((seat, idx) => {
      const prevBet = prevBetsRef.current.get(seat.userId) ?? 0;
      const pos = positions[idx] || { x: 50, y: 50 };

      if (seat.currentBet > prevBet && seat.currentBet > 0 && !prefersReducedMotion) {
        spawned.push({
          id: `bet-${pokerState.handNumber}-${pokerState.stateVersion}-${seat.userId}-${Date.now()}`,
          fromX: pos.x,
          fromY: pos.y,
          toX: 50,
          toY: 38,
          amount: seat.currentBet - prevBet,
          variant: 'bet',
        });
      } else if (streetChanged && prevBet > 0 && seat.currentBet === 0 && !prefersReducedMotion) {
        spawned.push({
          id: `sweep-${pokerState.handNumber}-${pokerState.street}-${seat.userId}-${Date.now()}`,
          fromX: pos.x + (50 - pos.x) * 0.25,
          fromY: pos.y + (38 - pos.y) * 0.25,
          toX: 50,
          toY: 38,
          amount: prevBet,
          variant: 'bet',
        });
      }
      prevBetsRef.current.set(seat.userId, seat.currentBet);
    });

    prevStreetRef.current = pokerState.street;

    if (spawned.length > 0) {
      setFlyingChips((curr) => [...curr, ...spawned].slice(-12));
      if (soundEngine.shouldPlayOnce(`chips:${pokerState.roomId}:${pokerState.handNumber}:${pokerState.stateVersion}`)) {
        soundEngine.playChipSlide();
      }
      const timer = setTimeout(() => {
        const ids = new Set(spawned.map((c) => c.id));
        setFlyingChips((curr) => curr.filter((c) => !ids.has(c.id)));
      }, 680);
      return () => clearTimeout(timer);
    }
  }, [arrangedSeats, positions, pokerState, prefersReducedMotion]);

  // Smooth chip flight from center pot -> winning seat(s) + 3D card flip sound when hole cards reveal
  useEffect(() => {
    if (!pokerState || !showdownReady || pokerState.winners.length === 0) return;

    const flipKey = `${pokerState.roomId}:${pokerState.handNumber}:flip`;
    if (flipKey !== prevShowdownFlipKeyRef.current) {
      prevShowdownFlipKeyRef.current = flipKey;
      const revealedOpponents = arrangedSeats.filter((s) => s.userId !== user?.id && !s.folded && Boolean(s.holeCards));
      if (revealedOpponents.length > 0 && soundEngine.shouldPlayOnce(`showflip:${flipKey}`)) {
        soundEngine.playCardFlip();
      }

      if (!prefersReducedMotion) {
        const payouts: FlyingChip[] = [];
        arrangedSeats.forEach((seat, idx) => {
          if (seat.isWinner && (seat.wonAmount ?? 0) > 0) {
            const pos = positions[idx] || { x: 50, y: 50 };
            payouts.push({
              id: `payout-${pokerState.handNumber}-${seat.userId}`,
              fromX: 50,
              fromY: 38,
              toX: pos.x,
              toY: pos.y,
              amount: seat.wonAmount ?? 0,
              variant: 'payout',
            });
          }
        });
        if (payouts.length > 0) {
          setFlyingChips((curr) => [...curr, ...payouts].slice(-12));
          const timer = setTimeout(() => {
            const ids = new Set(payouts.map((c) => c.id));
            setFlyingChips((curr) => curr.filter((c) => !ids.has(c.id)));
          }, 850);
          return () => clearTimeout(timer);
        }
      }
    }
  }, [arrangedSeats, positions, pokerState, prefersReducedMotion, showdownReady, user?.id]);

  const handleLeaveTable = async () => {
    soundEngine.unlock();
    try {
      await apiFetch(`/api/rooms/${roomId}/leave`, { method: 'POST' });
      await refreshWallet();
    } catch {
      // still exit
    }
    onExit();
  };

  const handleStartGame = async () => {
    soundEngine.unlock();
    try {
      await apiFetch(`/api/rooms/${roomId}/start`, { method: 'POST' });
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Unable to start hand');
    }
  };

  const handleSpeedChange = async (speed: GameSpeed) => {
    try {
      await apiFetch(`/api/rooms/${roomId}/speed`, {
        method: 'POST',
        body: JSON.stringify({ speed }),
      });
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Only host can change speed');
    }
  };

  const handleToggleOddsAssist = async () => {
    if (!pokerState) return;
    try {
      await apiFetch(`/api/rooms/${roomId}/probability-assist`, {
        method: 'POST',
        body: JSON.stringify({ enabled: !pokerState.allowProbabilityAssist }),
      });
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleAddBot = async () => {
    soundEngine.playChipClick();
    try {
      await apiFetch(`/api/rooms/${roomId}/bots`, {
        method: 'POST',
        body: JSON.stringify({ difficulty: 'normal' as BotDifficulty }),
      });
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Unable to add bot');
    }
  };

  const handleRemoveBot = async (botId: string) => {
    try {
      await apiFetch(`/api/rooms/${roomId}/bots/${botId}`, { method: 'DELETE' });
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Unable to remove bot');
    }
  };

  const handleBotDifficulty = async (botId: string, difficulty: BotDifficulty) => {
    try {
      await apiFetch(`/api/rooms/${roomId}/bots/${botId}/difficulty`, {
        method: 'PATCH',
        body: JSON.stringify({ difficulty }),
      });
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Cannot change difficulty mid-hand');
    }
  };

  const handleSendChat = async (e?: React.FormEvent, emoteText?: string) => {
    e?.preventDefault();
    const msg = emoteText || chatText.trim();
    if (!msg || (emoteText && (sendingReaction || isMyTurn))) return;
    if (emoteText) setSendingReaction(true);
    try {
      await apiFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          channelType: 'room',
          channelId: roomId,
          message: msg,
          isEmote: Boolean(emoteText),
        }),
      });
      if (!emoteText) setChatText('');
      else setShowQuickReactions(false);
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Message blocked');
    } finally {
      if (emoteText) setSendingReaction(false);
    }
  };

  const handleSubmitReport = async () => {
    if (!reportTarget) return;
    try {
      await apiFetch('/api/moderation/report', {
        method: 'POST',
        body: JSON.stringify({
          reportedUserId: reportTarget.userId,
          roomId,
          reason: reportReason,
          details: `Reported from poker table ${currentRoom?.name || roomId}`,
        }),
      });
      setStatusNotice(`Report filed for ${reportTarget.username}.`);
      setReportTarget(null);
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Could not file report');
    }
  };

  const activeSpeed: GameSpeed = pokerState?.gameSpeed || 'normal';
  const speedConfig = GAME_SPEED_CONFIG[activeSpeed];
  const nextHandSecs = pokerState?.nextHandAt ? Math.max(0, Math.ceil((pokerState.nextHandAt - nowMs) / 1000)) : null;

  return (
    <div
      onClick={() => soundEngine.unlock()}
      className="casino-screen relative flex flex-col h-[100dvh] w-full overflow-hidden bg-[#05060d] text-slate-100"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-20 bg-cover bg-center"
        style={{ backgroundImage: 'url(/src/assets/images/neon_hero_skyline_1795020140555.jpg)' }}
      />
      <div className="pointer-events-none absolute -top-24 left-1/4 w-[420px] h-[420px] rounded-full bg-purple-600/20 blur-[130px]" />
      <div className="pointer-events-none absolute -bottom-24 right-1/4 w-[420px] h-[420px] rounded-full bg-pink-500/15 blur-[130px]" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[360px] rounded-full bg-sky-500/12 blur-[120px]" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#05060d]/85 via-[#070914]/68 to-[#05060d]" />

      {/* Top Table HUD */}
      <header className="neon-casino-panel relative z-20 shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5 py-2.5 border-b border-sky-400/20 bg-[#080d1e]/90 backdrop-blur-xl shadow-[0_6px_28px_rgba(0,0,0,0.55)]">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={handleLeaveTable}
            className="btn-glossy btn-glossy-dark inline-flex items-center justify-center w-10 h-10 rounded-full text-slate-200 shrink-0"
            title="Leave Table"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-display font-bold text-white truncate">
                {currentRoom?.name || "Texas Hold'em"}
              </h1>
              {currentRoom?.code && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(currentRoom.code);
                    setStatusNotice(`Room code ${currentRoom.code} copied`);
                  }}
                  className="hidden sm:inline-flex items-center gap-1 rounded-full bg-slate-900/90 border border-cyan-400/35 px-2.5 py-0.5 font-mono text-[11px] text-cyan-300 hover:bg-slate-800 shadow-[0_0_12px_rgba(34,211,238,0.18)]"
                >
                  {currentRoom.code} <Copy className="w-3 h-3" />
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400 font-mono tabular-nums truncate">
              Blinds {pokerState?.smallBlind ?? 25}/{pokerState?.bigBlind ?? 50}
              {pokerState?.ante ? ` · Ante ${pokerState.ante}` : ''}
              {' · '}Hand #{pokerState?.handNumber ?? 0}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Synchronized Game Speed Cue (Host can switch directly) */}
          <div className="hidden md:flex items-center gap-1 rounded-full bg-slate-950/90 border border-sky-400/25 p-1 shadow-inner">
            <Gauge className="w-3.5 h-3.5 text-cyan-400 ml-2 mr-0.5" />
            {(['relaxed', 'normal', 'fast'] as GameSpeed[]).map((sp) => (
              <button
                key={sp}
                type="button"
                disabled={!isHost}
                onClick={() => void handleSpeedChange(sp)}
                title={isHost ? `Set table pacing to ${sp}` : `Host selected ${activeSpeed} speed`}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold capitalize transition ${
                  activeSpeed === sp
                    ? sp === 'relaxed'
                      ? 'bg-emerald-500/30 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                      : sp === 'fast'
                        ? 'bg-purple-500/35 text-purple-200 shadow-[0_0_12px_rgba(168,85,247,0.4)]'
                        : 'bg-cyan-500/30 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.4)]'
                    : 'text-slate-500 hover:text-slate-300'
                } ${!isHost ? 'cursor-default' : ''}`}
              >
                {sp}
              </button>
            ))}
          </div>

          {currentTournament && onOpenTournamentInfo && (
            <button
              type="button"
              onClick={() => onOpenTournamentInfo(currentTournament.id)}
              className="btn-glossy inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 border border-amber-400/50 px-3 py-2 text-xs font-semibold text-amber-200 min-h-[40px]"
            >
              <Trophy className="w-4 h-4 text-amber-300" />
              <span className="hidden lg:inline">Tournament</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowOddsDrawer((v) => !v)}
            className={`btn-glossy inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition min-h-[40px] ${
              showOddsDrawer
                ? 'btn-glossy-green border-emerald-300/60 text-slate-950 font-bold'
                : 'btn-glossy-dark text-slate-100'
            }`}
          >
            <Sparkles className={`w-4 h-4 ${showOddsDrawer ? 'text-slate-950' : 'text-emerald-400'}`} />
            <span className="hidden sm:inline">
              {pokerState?.handStrength && pokerState.allowProbabilityAssist
                ? `${pokerState.handStrength.winProbability}%`
                : 'Odds'}
            </span>
          </button>

          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="Quick poker reactions"
              aria-expanded={showQuickReactions}
              disabled={isMyTurn}
              onClick={() => {
                setShowChatDrawer(false);
                setShowQuickReactions((v) => !v);
              }}
              className="btn-glossy btn-glossy-purple rounded-full w-10 h-10 flex items-center justify-center text-lg disabled:opacity-45"
              title={isMyTurn ? "Focus on your turn" : "Send a table reaction"}
            >😂</button>
            {showQuickReactions && !isMyTurn && (
              <div role="group" aria-label="Choose a poker reaction"
                className="absolute right-0 top-full mt-2 z-[60] rounded-2xl border border-violet-300/50 bg-[#100c30]/95 shadow-[0_0_22px_rgba(126,75,255,.45)] px-2 py-2 flex items-center gap-1 max-w-[calc(100vw-12px)]">
                {QUICK_EMOTES.map((em) => (
                  <button
                    key={em}
                    type="button"
                    disabled={sendingReaction}
                    aria-label={`Send ${em} poker reaction`}
                    onClick={() => void handleSendChat(undefined, em)}
                    className="btn-glossy btn-glossy-dark w-9 h-9 shrink-0 rounded-full text-base disabled:opacity-50"
                  >{em}</button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setShowQuickReactions(false);
              setShowChatDrawer((v) => !v);
            }}
            className={`btn-glossy inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition min-h-[40px] ${
              showChatDrawer
                ? 'btn-glossy-blue border-sky-300/60 text-white'
                : 'btn-glossy-dark text-slate-100'
            }`}
          >
            <MessageSquare className={`w-4 h-4 ${showChatDrawer ? 'text-white' : 'text-cyan-400'}`} />
            <span className="hidden sm:inline">Chat</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="btn-glossy btn-glossy-dark inline-flex items-center justify-center w-10 h-10 rounded-full text-slate-200"
            title="Table Settings & Speed"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
        <TableBankroll />
      </header>

      {(actionError || statusNotice) && (
        <div className="relative z-30 mx-auto mt-2 px-4 py-1.5 rounded-xl bg-amber-500/15 border border-amber-400/50 text-xs font-medium text-amber-200 flex items-center gap-3">
          <span>{actionError || statusNotice}</span>
          <button
            type="button"
            onClick={() => {
              clearActionError();
              setStatusNotice(null);
            }}
            className="text-amber-300 hover:text-white font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Felt Arena */}
      <main className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-6 py-1 sm:py-2 overflow-hidden">
        <div className="relative w-full max-w-4xl h-full max-h-[520px] min-h-[330px] flex items-center justify-center">
          <div className="relative w-[90%] sm:w-[84%] h-[68%] sm:h-[74%] rounded-[130px] sm:rounded-[210px] p-2 sm:p-4 casino-rail">
            <div className="relative w-full h-full rounded-[118px] sm:rounded-[195px] casino-felt flex flex-col items-center justify-center px-3 sm:px-4">
              {/* Mobile Speed Cue (Tap to cycle when host) */}
              <button
                type="button"
                disabled={!isHost}
                onClick={() => {
                  if (!isHost) return;
                  const next = SPEED_CYCLE[(SPEED_CYCLE.indexOf(activeSpeed) + 1) % SPEED_CYCLE.length];
                  void handleSpeedChange(next);
                }}
                className={`md:hidden mb-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                  isHost
                    ? 'text-cyan-200 border-cyan-400/30 bg-slate-950/60 hover:border-cyan-300'
                    : 'text-emerald-200/75 border-transparent'
                }`}
              >
                Pacing: {activeSpeed}{isHost ? ' ↻' : ''}
              </button>

              {/* Subtle Felt Branding */}
              <div className="pointer-events-none select-none text-center mb-1">
                <span className="font-display font-extrabold tracking-[0.24em] text-[10px] sm:text-[11px] text-amber-300/35 uppercase">
                  MIDNIGHT POKER CLUB
                </span>
              </div>

              {/* Pot & Side Pots */}
              <div className="flex flex-col items-center gap-1.5 mb-2.5">
                <ChipStack amount={pokerState?.pot ?? 0} label="POT" size="md" animateWin={showdownReady} />
                {pokerState && pokerState.sidePots.length > 1 && (
                  <div className="flex flex-wrap justify-center gap-2 text-[11px] font-mono text-amber-200/90">
                    {pokerState.sidePots.map((sp, i) => (
                      <span key={i}>
                        {i === 0 ? 'Main' : `Side ${i}`}: {sp.amount.toLocaleString()}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Riffle Shuffle Deck Animation at Hand Start */}
              <AnimatePresence>
                {shufflingHand && !prefersReducedMotion && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    className="absolute top-6 right-8 sm:right-14 flex items-center gap-1.5 z-20"
                  >
                    <motion.div
                      animate={{ x: [-6, 6, -4, 0], rotate: [-4, 4, -2, 0] }}
                      transition={{ duration: 0.45, repeat: 1 }}
                    >
                      <PlayingCard faceDown size="xs" reducedMotion />
                    </motion.div>
                    <motion.div
                      animate={{ x: [6, -6, 4, 0], rotate: [4, -4, 2, 0] }}
                      transition={{ duration: 0.45, repeat: 1 }}
                      className="-ml-6"
                    >
                      <PlayingCard faceDown size="xs" reducedMotion />
                    </motion.div>
                    <span className="text-[10px] font-mono text-cyan-200/90">Shuffling</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Community Cards (Paced Street-by-Street Reveal + 3D Flip) */}
              <div className="flex items-center justify-center gap-1 sm:gap-2.5 min-h-[68px] sm:min-h-[92px]">
                {pokerState && pokerState.communityCards.length > 0 ? (
                  pokerState.communityCards.map((card, idx) => {
                    const isVisible = idx < revealedBoardCount;
                    const isWinningCard =
                      showdownReady &&
                      winningCardSet.some((wc) => cardsEqual(wc, card));
                    return (
                      <PlayingCard
                        key={`${pokerState.handNumber}-board-${idx}`}
                        card={isVisible ? card : null}
                        faceDown={!isVisible}
                        size="board"
                        highlighted={isWinningCard}
                        reducedMotion={prefersReducedMotion}
                      />
                    );
                  })
                ) : (
                  <div className="text-center px-4">
                    {pokerState?.street === 'waiting' ? (
                      <div className="flex flex-col items-center gap-2.5">
                        <p className="text-xs sm:text-sm font-medium text-emerald-100/85">
                          {(pokerState?.seats.length ?? 0) < 2
                            ? `Waiting for players (${pokerState?.seats.length ?? 0}/${currentRoom?.maxPlayers ?? 9}) — Share code ${currentRoom?.code}`
                            : 'Ready to deal the next hand'}
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {isHost &&
                            !currentRoom?.tournamentId &&
                            (pokerState?.seats.length ?? 0) < (currentRoom?.maxPlayers ?? 9) && (
                              <button
                                type="button"
                                onClick={() => void handleAddBot()}
                                className="btn-glossy btn-glossy-purple inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-white font-display font-bold text-xs border border-purple-300/50"
                              >
                                <Plus className="w-3.5 h-3.5" /> Add Bot
                              </button>
                            )}
                          {isHost && (pokerState?.seats.length ?? 0) >= 2 && (
                            <button
                              type="button"
                              onClick={handleStartGame}
                              className="btn-glossy btn-glossy-green px-5 py-2.5 rounded-full text-slate-950 font-display font-extrabold text-sm border border-emerald-200/60"
                            >
                              Start Hand
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs uppercase tracking-widest text-emerald-200/50 font-display">
                        Preflop Betting
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Winner Spotlight Banner */}
              <AnimatePresence>
                {showdownReady && primaryWinner && (
                  <motion.div
                    initial={{ opacity: 0, y: 12, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="mt-3 px-4 py-2 rounded-2xl bg-gradient-to-r from-amber-500/25 via-emerald-500/25 to-amber-500/25 border border-amber-300/70 backdrop-blur-md text-center shadow-[0_0_28px_rgba(250,204,21,0.45)]"
                  >
                    <div className="flex items-center justify-center gap-2 text-amber-300 font-display font-extrabold text-sm sm:text-base tracking-wide">
                      <Trophy className="w-4 h-4" />
                      <span>
                        WINNER! {pokerState!.winners.map((w) => `${w.username} (+${w.amount.toLocaleString()})`).join(' · ')}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-emerald-200 mt-0.5">
                      {primaryWinner.handDescription}
                      {nextHandSecs !== null && ` · Next hand in ${nextHandSecs}s`}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Player Seats Around Oval */}
          {arrangedSeats.map((seat, idx) => {
            const pos = positions[idx] || { x: 50, y: 50 };
            const isLocal = seat.userId === user?.id;
            const seatIsWinner = showdownReady && seat.isWinner;
            const ringStyle = seatIsWinner
              ? 'border-amber-400 bg-gradient-to-b from-amber-950/95 to-emerald-950/95 animate-winner-spotlight'
              : seat.isCurrentTurn
                ? 'border-sky-400 bg-[#0d172c]/95 animate-turn-ring'
                : seat.folded
                  ? 'border-rose-500/60 bg-slate-950/85 opacity-60'
                  : seat.sittingOut
                    ? 'border-slate-600/60 bg-slate-950/75 opacity-65'
                    : 'border-slate-700/90 bg-[#0a1020]/95';

            // Compute vector from center of table (50,50) to seat so cards fly from center dealer
            const dealFrom = {
              x: (50 - pos.x) * 1.6,
              y: (50 - pos.y) * 1.4,
            };
            const dealStepSec = Math.min(0.65, (speedConfig.dealCardMs / 1000) * 0.45);

            const isBottomSeat = pos.y > 70;
            return (
              <div
                key={seat.userId}
                data-testid={`poker-seat-${seat.seatIndex}`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
                className="absolute z-10 flex flex-col items-center gap-1 sm:gap-1.5"
              >
                {/* Current Bet on Felt side for bottom seat so it points toward pot without overflowing footer */}
                {isBottomSeat && seat.currentBet > 0 && (
                  <div className="mb-0.5 pointer-events-none">
                    <ChipStack amount={seat.currentBet} size="sm" />
                  </div>
                )}

                {/* Cards (Zero CSS scale transform or overlapping badges so hole cards remain 100% visible) */}
                {seat.cardCount > 0 && (
                  <div
                    data-testid={`poker-seat-cards-${seat.seatIndex}`}
                    className={`flex items-center ${isLocal ? 'gap-1 sm:gap-1.5' : '-space-x-1 sm:-space-x-1.5'} mb-0.5 sm:mb-1`}
                  >
                    {Array.from({ length: seat.cardCount }).map((_, cIdx) => {
                      const revealedCard = seat.holeCards ? seat.holeCards[cIdx] ?? null : null;
                      const isFaceUp = Boolean(revealedCard);
                      const isWinCard =
                        seatIsWinner &&
                        Boolean(revealedCard) &&
                        (seat.winningCards || []).some((wc) => cardsEqual(wc, revealedCard!));
                      return (
                        <PlayingCard
                          key={`${pokerState?.handNumber}-hole-${seat.userId}-${cIdx}`}
                          card={revealedCard}
                          faceDown={!isFaceUp}
                          size={isLocal && isFaceUp ? 'hole' : 'xs'}
                          highlighted={isWinCard}
                          dimmed={seat.folded}
                          foldedAway={seat.folded && !isLocal}
                          dealFrom={dealFrom}
                          dealDelaySec={(idx + cIdx * arrangedSeats.length) * dealStepSec * 0.35}
                          reducedMotion={prefersReducedMotion}
                        />
                      );
                    })}
                  </div>
                )}

                {/* Seat Plate (strict separation from hole cards above; badges sit cleanly inside/below) */}
                <div
                  data-testid={`poker-seat-plate-${seat.seatIndex}`}
                  className={`relative flex items-center gap-1.5 sm:gap-2 rounded-2xl sm:rounded-[24px] border-2 px-2 py-1 sm:px-3 sm:py-1.5 min-w-[96px] sm:min-w-[152px] max-w-[126px] sm:max-w-[196px] shadow-[0_10px_28px_rgba(0,0,0,0.65)] backdrop-blur-md transition-all ${ringStyle}`}
                >
                  <button type="button" disabled={Boolean(seat.isBot)} aria-label={`View ${seat.username} profile`} title={seat.isBot ? 'Poker bot' : `View ${seat.username} stats`} onClick={(event) => { event.stopPropagation(); setViewPlayerId(seat.userId); }} className="shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:cursor-default">
                    <PlayerAvatar avatarId={seat.avatarId} username={seat.username} size={isLocal ? 'sm' : 'xs'} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className={`text-[11px] sm:text-xs font-semibold truncate ${seatIsWinner ? 'text-amber-300' : 'text-white'}`}>
                        {isLocal ? 'You' : seat.username}
                      </span>
                      {seat.isBot && (
                        <span
                          title={`Poker Bot (${seat.botDifficulty || 'normal'})`}
                          className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-full bg-gradient-to-r from-purple-500/45 to-sky-500/45 border border-purple-300/60 text-purple-100 font-display text-[8px] sm:text-[9px] font-extrabold tracking-wider shrink-0"
                        >
                          BOT
                        </span>
                      )}
                      {seat.isDealer && (
                        <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-amber-400 text-slate-950 font-display font-extrabold text-[9px] sm:text-[10px] inline-flex items-center justify-center shrink-0 shadow">
                          D
                        </span>
                      )}
                      {seat.isSmallBlind && (
                        <span className="px-1 rounded-full bg-sky-500/30 text-sky-200 font-mono text-[8px] sm:text-[9px] font-bold shrink-0">SB</span>
                      )}
                      {seat.isBigBlind && (
                        <span className="px-1 rounded-full bg-purple-500/30 text-purple-200 font-mono text-[8px] sm:text-[9px] font-bold shrink-0">BB</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-1.5 mt-0.5">
                      <span className="font-mono text-[11px] sm:text-xs font-bold text-amber-300 tabular-nums truncate">
                        {seat.chips.toLocaleString()}
                      </span>
                      {seat.isCurrentTurn && turnSecondsLeft !== null && (
                        <span className={`font-mono text-[10px] sm:text-[11px] font-bold tabular-nums shrink-0 ${turnSecondsLeft <= 5 ? 'text-rose-400' : 'text-sky-300'}`}>
                          {turnSecondsLeft}s
                        </span>
                      )}
                    </div>
                  </div>

                  {!isLocal && seat.isBot && isHost && pokerState?.street === 'waiting' && !currentRoom?.tournamentId ? (
                    <button
                      type="button"
                      onClick={() => void handleRemoveBot(seat.userId)}
                      className="p-0.5 sm:p-1 rounded-full text-slate-400 hover:text-rose-300 hover:bg-rose-500/15 transition shrink-0"
                      title={`Remove ${seat.username}`}
                    >
                      <X className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    </button>
                  ) : !isLocal && !seat.isBot ? (
                    <button
                      type="button"
                      onClick={() => setReportTarget(seat)}
                      className="p-0.5 sm:p-1 text-slate-500 hover:text-rose-400 transition shrink-0"
                      title={`Report ${seat.username}`}
                    >
                      <Flag className="w-3 h-3" />
                    </button>
                  ) : null}
                </div>

                {/* Winner / Action / Status Pill (rendered strictly below plate, never over hole cards) */}
                {seatIsWinner && seat.wonAmount ? (
                  <div className="rounded-full bg-gradient-to-r from-amber-300 to-emerald-400 px-2.5 py-0.5 text-[10px] font-display font-extrabold text-slate-950 whitespace-nowrap shadow-[0_0_14px_rgba(250,204,21,0.7)]">
                    +{seat.wonAmount.toLocaleString()}
                  </div>
                ) : seat.lastAction ? (
                  <div className="rounded-full bg-slate-950/95 border border-cyan-400/45 px-2 py-0.5 text-[9px] sm:text-[10px] font-semibold text-cyan-200 whitespace-nowrap shadow">
                    {seat.lastAction}
                  </div>
                ) : seat.sittingOut ? (
                  <div className="rounded-full bg-slate-900 border border-slate-600 px-2 py-0.5 text-[9px] sm:text-[10px] text-slate-300 whitespace-nowrap">
                    Sitting Out
                  </div>
                ) : null}

                {!isBottomSeat && seat.currentBet > 0 && (
                  <div className="pointer-events-none">
                    <ChipStack amount={seat.currentBet} size="sm" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Animated Smooth Chip Flights (Seat -> Pot Bets & Pot -> Winner Payouts) */}
          <AnimatePresence>
            {!prefersReducedMotion &&
              flyingChips.map((chip) => (
                <motion.div
                  key={chip.id}
                  initial={{ left: `${chip.fromX}%`, top: `${chip.fromY}%`, scale: 0.75, opacity: 0.95 }}
                  animate={{ left: `${chip.toX}%`, top: `${chip.toY}%`, scale: 1, opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.65 }}
                  transition={{
                    duration: chip.variant === 'payout' ? 0.72 : Math.max(0.32, Math.min(0.65, speedConfig.dealCardMs / 1600)),
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  style={{ transform: 'translate(-50%, -50%)', willChange: 'left, top, transform, opacity' }}
                  className="pointer-events-none absolute z-30 flex items-center gap-1 rounded-full bg-black/80 border border-pink-400/70 px-2 py-0.5 shadow-[0_0_18px_rgba(236,72,153,0.65)]"
                >
                  <span
                    className={`w-3.5 h-3.5 rounded-full border-2 border-dashed ${
                      chip.variant === 'payout'
                        ? 'bg-amber-400 border-amber-100'
                        : 'bg-purple-500 border-sky-300'
                    }`}
                  />
                  <span className="font-mono text-[10px] font-bold text-amber-300 tabular-nums">
                    +{chip.amount.toLocaleString()}
                  </span>
                </motion.div>
              ))}
          </AnimatePresence>
        </div>

        {/* Hand Strength & Probability Drawer */}
        <AnimatePresence>
          {showOddsDrawer && (
            <motion.aside
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              className="glass-bubbly absolute left-2 sm:left-4 top-2 bottom-2 w-72 sm:w-80 z-30 rounded-[28px] p-4 overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-display font-bold text-white">Your Hand Strength</h2>
                <button
                  type="button"
                  onClick={() => setShowOddsDrawer(false)}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Close
                </button>
              </div>

              {mySeat?.holeCards && pokerState?.handStrength ? (
                <>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/90 border border-slate-800">
                    <div className="flex -space-x-2">
                      {mySeat.holeCards.map((c, i) => (
                        <PlayingCard key={i} card={c} size="xs" reducedMotion={prefersReducedMotion} />
                      ))}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-emerald-400">
                        {pokerState.handStrength.strengthLabel}
                        {pokerState.allowProbabilityAssist && ` · ${pokerState.handStrength.winProbability}% est.`}
                      </p>
                      <p className="text-sm font-display font-bold text-white truncate">
                        {pokerState.handStrength.currentDescription}
                      </p>
                      <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
                        {pokerState.handStrength.summaryHint}
                      </p>
                    </div>
                  </div>

                  {pokerState.allowProbabilityAssist ? (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-[11px] text-slate-400">
                        Estimated distribution ({pokerState.handStrength.simulations} live rollouts):
                      </p>
                      {pokerState.handStrength.categoryOdds.map((row) => (
                        <div key={row.category} className="flex items-center justify-between text-xs py-1 border-b border-slate-800/60">
                          <span className="text-slate-300">{row.category}</span>
                          <span className="font-mono font-semibold text-cyan-300 tabular-nums">
                            {row.probability.toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-amber-300">
                      Win probability estimates were disabled by the table host for competitive play.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-400">Deal a hand to view real-time hand strength and equity calculations.</p>
              )}
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Collapsible Room Chat & Emotes Drawer */}
        <AnimatePresence>
          {showChatDrawer && (
            <motion.aside
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              className="glass-bubbly absolute right-2 sm:right-4 top-2 bottom-2 w-72 sm:w-80 z-30 rounded-[28px] p-3.5 flex flex-col"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h2 className="text-sm font-display font-bold text-white">Table Chat</h2>
                <button type="button" onClick={() => setShowChatDrawer(false)} className="text-xs text-slate-400 hover:text-white">
                  Close
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 py-2.5 pr-1">
                {roomChat.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">No messages yet. Say hello or send an emote!</p>
                ) : (
                  roomChat.map((m) => (
                    <div key={m.id} className="text-xs leading-relaxed">
                      <span className="font-semibold text-cyan-300">{m.senderUsername}: </span>
                      <span className={m.isEmote ? 'text-base' : 'text-slate-200'}>{m.message}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between gap-1 py-1.5 border-t border-slate-800">
                {QUICK_EMOTES.map((em) => (
                  <button
                    key={em}
                    type="button"
                    aria-label={`Send ${em} poker reaction`}
                    disabled={sendingReaction || isMyTurn}
                    onClick={() => void handleSendChat(undefined, em)}
                    className="btn-glossy btn-glossy-dark w-9 h-9 shrink-0 rounded-full text-base disabled:opacity-50"
                  >
                    {em}
                  </button>
                ))}
              </div>

              <form onSubmit={(e) => void handleSendChat(e)} className="flex items-center gap-1.5 pt-1.5">
                <input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="Type table message..."
                  maxLength={240}
                  className="input-bubbly flex-1 rounded-full px-3.5 py-2 text-xs text-white"
                />
                <button
                  type="submit"
                  className="btn-glossy btn-glossy-blue w-9 h-9 rounded-full text-white flex items-center justify-center shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </motion.aside>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom HUD Row: Current Hand Strength Info + Bottom-Right Last Hand Winner Box */}
      <section
        aria-label="Current Hand Info and Last Hand Winner"
        className="relative z-20 px-2.5 sm:px-6 pb-2 pt-0.5 shrink-0"
      >
        <div className="max-w-4xl mx-auto flex items-stretch justify-between gap-2 sm:gap-3">
          {/* Hand Info Panel */}
          <div
            data-testid="holdem-hand-panel"
            className="glass-bubbly flex-1 min-w-0 rounded-2xl sm:rounded-3xl px-3 py-1.5 sm:px-4 sm:py-2 border border-sky-400/35 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-3"
          >
            <div className="min-w-0">
              <p className="text-[11px] sm:text-xs font-display font-bold text-white truncate">
                <span className="text-sky-300">Your Hand:</span> {liveHandSummary.handName}
              </p>
              <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">
                {liveHandSummary.detail}
              </p>
            </div>
            {liveHandSummary.strengthTier ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] sm:text-[11px] text-slate-400 font-semibold">Strength:</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] sm:text-xs font-display font-extrabold border ${
                    liveHandSummary.strengthTier === 'Strong'
                      ? 'bg-emerald-500/20 border-emerald-400/55 text-emerald-300'
                      : liveHandSummary.strengthTier === 'Medium'
                        ? 'bg-amber-500/20 border-amber-400/55 text-amber-300'
                        : 'bg-rose-500/20 border-rose-400/55 text-rose-300'
                  }`}
                >
                  {liveHandSummary.strengthTier}
                  {liveHandSummary.winProbability !== null && (
                    <span className="font-mono text-[10px] opacity-90 tabular-nums">
                      ({liveHandSummary.winProbability}%)
                    </span>
                  )}
                </span>
              </div>
            ) : (
              <span className="text-[10px] font-mono text-slate-500 shrink-0">Strength: —</span>
            )}
          </div>

          {/* Persistent Bottom-Right Last Hand Winner Box */}
          <div
            data-testid="holdem-last-hand-box"
            className="glass-bubbly w-[154px] sm:w-[232px] shrink-0 rounded-2xl sm:rounded-3xl px-3 py-1.5 sm:px-4 sm:py-2 border border-amber-400/40 flex flex-col justify-center text-right sm:text-left"
          >
            <p className="text-[9px] sm:text-[10px] font-display font-extrabold uppercase tracking-wider text-amber-300">
              Last Hand
            </p>
            {lastHandSummary ? (
              <>
                <p className="text-[11px] sm:text-xs font-bold text-white truncate">
                  {lastHandSummary.headline}
                </p>
                <p className="text-[10px] sm:text-[11px] font-medium text-emerald-300 truncate">
                  {lastHandSummary.subtitle}
                </p>
                {lastReplay && (
                  <button type="button" onClick={() => { setReplayStep(0); setShowReplay(true); }}
                    className="self-end text-[10px] font-extrabold text-cyan-300 underline underline-offset-2 mt-0.5">
                    Replay hand
                  </button>
                )}
              </>
            ) : (
              <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">
                Waiting for first hand
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Bottom Action Bar */}
      <footer className="relative z-20 border-t border-sky-400/20 bg-[#080d1e]/92 backdrop-blur-xl px-3 sm:px-6 py-2 sm:py-2.5 shadow-[0_-8px_28px_rgba(0,0,0,0.55)]">
        {isMyTurn && legal ? (
          <div className="max-w-3xl mx-auto flex flex-col gap-2">
            {(legal.canBet || legal.canRaise) && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="range"
                  min={legal.minBetOrRaiseTo}
                  max={legal.maxBetOrRaiseTo}
                  step={Math.max(5, pokerState?.smallBlind ?? 5)}
                  value={betAmount}
                  onChange={(e) => setBetAmount(Number(e.target.value))}
                  className="flex-1 min-w-[140px] accent-cyan-400 h-2 bg-slate-800 rounded-full cursor-pointer"
                />
                <div className="flex items-center gap-1.5">
                  {[
                    { label: 'Min', val: legal.minBetOrRaiseTo },
                    { label: '½ Pot', val: Math.max(legal.minBetOrRaiseTo, Math.min(legal.maxBetOrRaiseTo, Math.floor((pokerState?.pot ?? 0) * 0.5) + (pokerState?.currentBet ?? 0))) },
                    { label: 'Pot', val: Math.max(legal.minBetOrRaiseTo, Math.min(legal.maxBetOrRaiseTo, (pokerState?.pot ?? 0) + (pokerState?.currentBet ?? 0))) },
                    { label: 'All In', val: legal.maxBetOrRaiseTo },
                  ].map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => setBetAmount(q.val)}
                      className="btn-glossy btn-glossy-dark px-3 py-1.5 rounded-full text-[11px] font-semibold text-slate-100 whitespace-nowrap"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                disabled={!legal.canFold}
                onClick={() => void sendPokerAction('fold')}
                className="btn-glossy btn-glossy-pink min-h-[48px] rounded-full border border-rose-300/45 text-white font-display font-bold text-sm disabled:opacity-40"
              >
                Fold
              </button>

              {legal.canCheck ? (
                <button
                  type="button"
                  onClick={() => void sendPokerAction('check')}
                  className="btn-glossy btn-glossy-blue min-h-[48px] rounded-full border border-sky-300/50 text-white font-display font-bold text-sm"
                >
                  Check
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!legal.canCall}
                  onClick={() => void sendPokerAction('call')}
                  className="btn-glossy btn-glossy-blue min-h-[48px] rounded-full border border-sky-300/50 text-white font-display font-bold text-sm disabled:opacity-40"
                >
                  Call {legal.callAmount.toLocaleString()}
                </button>
              )}

              {legal.canBet || legal.canRaise ? (
                <button
                  type="button"
                  onClick={() =>
                    void sendPokerAction(
                      betAmount >= legal.maxBetOrRaiseTo ? 'all_in' : legal.canBet ? 'bet' : 'raise',
                      betAmount
                    )
                  }
                  className="btn-glossy btn-glossy-green min-h-[48px] rounded-full border border-emerald-200/50 text-slate-950 font-display font-extrabold text-sm"
                >
                  {betAmount >= legal.maxBetOrRaiseTo
                    ? `All In ${legal.maxBetOrRaiseTo.toLocaleString()}`
                    : `${legal.canBet ? 'Bet' : 'Raise'} ${betAmount.toLocaleString()}`}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!legal.canAllIn}
                  onClick={() => void sendPokerAction('all_in')}
                  className="btn-glossy btn-glossy-gold min-h-[48px] rounded-full border border-amber-200/60 text-slate-950 font-display font-extrabold text-sm disabled:opacity-40"
                >
                  All In
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              {mySeat?.sittingOut ? (
                <span>You are sitting out.</span>
              ) : pokerState?.currentTurnUserId ? (
                <span className="inline-flex items-center gap-1.5">
                  Waiting for{' '}
                  <strong className="text-sky-300">
                    {pokerState.seats.find((s) => s.userId === pokerState.currentTurnUserId)?.username || 'player'}
                  </strong>
                  {pokerState.seats.find((s) => s.userId === pokerState.currentTurnUserId)?.isBot && (
                    <span className="px-1.5 py-0.5 rounded-full bg-purple-500/30 border border-purple-300/50 text-[9px] font-bold text-purple-100">
                      BOT
                    </span>
                  )}
                  ...
                </span>
              ) : (
                <span>
                  {pokerState?.street === 'showdown'
                    ? 'Highlighting hand winner...'
                    : 'Waiting for table action'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {mySeat && !currentRoom?.tournamentId && (
                <button
                  type="button"
                  onClick={() =>
                    void apiFetch(`/api/rooms/${roomId}/poker/sit-out`, {
                      method: 'POST',
                      body: JSON.stringify({ sittingOut: !mySeat.sittingOut }),
                    })
                  }
                  className="btn-glossy btn-glossy-dark px-3.5 py-2 rounded-full text-xs font-semibold text-slate-200 min-h-[40px]"
                >
                  {mySeat.sittingOut ? 'Sit Back In' : 'Sit Out'}
                </button>
              )}
              {isHost &&
                pokerState?.street === 'waiting' &&
                !currentRoom?.tournamentId &&
                (pokerState?.seats.length ?? 0) < (currentRoom?.maxPlayers ?? 9) && (
                  <button
                    type="button"
                    onClick={() => void handleAddBot()}
                    className="btn-glossy btn-glossy-purple inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold text-white border border-purple-300/50 min-h-[40px]"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Bot
                  </button>
                )}
              {isHost && pokerState?.street === 'waiting' && (pokerState?.seats.length ?? 0) >= 2 && (
                <button
                  type="button"
                  onClick={handleStartGame}
                  className="btn-glossy btn-glossy-green px-4 py-2 rounded-full text-slate-950 text-xs font-display font-extrabold min-h-[40px] border border-emerald-200/50"
                >
                  Deal Hand
                </button>
              )}
            </div>
          </div>
        )}
      </footer>

      {/* Table Settings & Host Speed Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="glass-bubbly w-full max-w-md rounded-[32px] p-6 space-y-5 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-display font-bold text-white">Table Settings</h3>
              <button type="button" onClick={() => setShowSettingsModal(false)} className="text-sm text-slate-400 hover:text-white">
                Close
              </button>
            </div>

            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 mb-2">
                <Gauge className="w-4 h-4 text-cyan-400" />
                <span>Game Pacing Speed {isHost ? '(Host Synchronized)' : '(Controlled by Host)'}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['relaxed', 'normal', 'fast'] as GameSpeed[]).map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    disabled={!isHost}
                    onClick={() => void handleSpeedChange(sp)}
                    className={`btn-glossy py-2.5 px-3 rounded-full border text-xs font-semibold capitalize transition ${
                      activeSpeed === sp
                        ? 'btn-glossy-blue border-cyan-300/60 text-white'
                        : 'btn-glossy-dark text-slate-400'
                    } ${!isHost ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {sp}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                {activeSpeed === 'relaxed'
                  ? 'Relaxed: 1.5s dealing · 2s community reveals · 4s winner spotlight · 5s next hand.'
                  : activeSpeed === 'fast'
                    ? 'Fast: 0.3s dealing · 0.7s community reveals · 2s winner spotlight · 2s next hand.'
                    : 'Normal (Default): 0.8s dealing · 1.5s community reveals · 3s winner spotlight · 4s next hand.'}
              </p>
            </div>

            {isHost && pokerState && pokerState.seats.some((s) => s.isBot) && (
              <div className="p-3.5 rounded-2xl bg-slate-950/75 border border-purple-400/30 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-purple-300" />
                    <span className="text-sm font-display font-bold text-white">Table Bots</span>
                  </div>
                  {pokerState.street !== 'waiting' && pokerState.street !== 'showdown' && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-[10px] font-semibold text-amber-200">
                      Difficulty locked during active hand
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {pokerState.seats
                    .filter((s) => s.isBot)
                    .map((bot) => {
                      const diffLocked =
                        pokerState.street !== 'waiting' && pokerState.street !== 'showdown';
                      return (
                        <div
                          key={bot.userId}
                          className="flex items-center justify-between gap-2 rounded-2xl bg-slate-900/90 border border-slate-800 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                              <span>{bot.username}</span>
                              <span className="px-1.5 py-0.5 rounded-full bg-purple-500/30 text-purple-200 text-[9px] font-bold">
                                BOT
                              </span>
                            </p>
                            <p className="font-mono text-[11px] text-amber-300">
                              {bot.chips.toLocaleString()} chips
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <select
                              aria-label={`Difficulty for ${bot.username}`}
                              disabled={diffLocked}
                              value={bot.botDifficulty || 'normal'}
                              onChange={(e) =>
                                void handleBotDifficulty(bot.userId, e.target.value as BotDifficulty)
                              }
                              className="input-bubbly rounded-full px-2.5 py-1 text-[11px] font-semibold text-cyan-200 disabled:opacity-50"
                            >
                              <option value="easy">Easy</option>
                              <option value="normal">Normal</option>
                              <option value="hard">Hard</option>
                            </select>
                            {pokerState.street === 'waiting' && !currentRoom?.tournamentId && (
                              <button
                                type="button"
                                onClick={() => void handleRemoveBot(bot.userId)}
                                className="p-1.5 rounded-full bg-rose-500/20 border border-rose-400/40 text-rose-300 hover:bg-rose-500/35"
                                title={`Remove ${bot.username}`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {isHost && (
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800">
                <div>
                  <p className="text-sm font-semibold text-white">Win Probability Assist</p>
                  <p className="text-xs text-slate-400">Allow players to inspect live hand equity %</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleToggleOddsAssist()}
                  className={`btn-glossy px-3.5 py-1.5 rounded-full text-xs font-bold ${
                    pokerState?.allowProbabilityAssist ? 'btn-glossy-green text-slate-950' : 'btn-glossy-dark text-slate-200'
                  }`}
                >
                  {pokerState?.allowProbabilityAssist ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            )}

            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800">
              <div className="flex items-center gap-2">
                {user?.soundEnabled ? <Volume2 className="w-4 h-4 text-cyan-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
                <div>
                  <p className="text-sm font-semibold text-white">Casino Sound Effects</p>
                  <p className="text-xs text-slate-400">Cards, chips, and celebration audio</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void updateProfile({ soundEnabled: !user?.soundEnabled })}
                className={`btn-glossy px-3.5 py-1.5 rounded-full text-xs font-bold ${
                  user?.soundEnabled ? 'btn-glossy-blue text-white' : 'btn-glossy-dark text-slate-200'
                }`}
              >
                {user?.soundEnabled ? 'On' : 'Muted'}
              </button>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800">
              <div>
                <p className="text-sm font-semibold text-white">Reduced Motion</p>
                <p className="text-xs text-slate-400">Minimize card flight &amp; spotlight pulses</p>
              </div>
              <button
                type="button"
                onClick={() => void updateProfile({ reducedAnimations: !user?.reducedAnimations })}
                className={`btn-glossy px-3.5 py-1.5 rounded-full text-xs font-bold ${
                  user?.reducedAnimations ? 'btn-glossy-purple text-white' : 'btn-glossy-dark text-slate-200'
                }`}
              >
                {user?.reducedAnimations ? 'Reduced' : 'Full FX'}
              </button>
            </div>

            <div className="pt-2 flex justify-between items-center text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> {pokerState?.seats.length ?? 0}/{currentRoom?.maxPlayers ?? 9} Seated
              </span>
              <button
                type="button"
                onClick={handleLeaveTable}
                className="btn-glossy btn-glossy-pink px-4 py-2 rounded-full text-white font-semibold"
              >
                Leave Table
              </button>
            </div>
          </div>
        </div>
      )}

      {reportTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="glass-bubbly w-full max-w-sm rounded-[28px] p-5 space-y-4">
            <div className="flex items-center gap-2 text-rose-400 font-display font-bold">
              <ShieldAlert className="w-5 h-5" />
              <h3>Report {reportTarget.username}</h3>
            </div>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="input-bubbly w-full rounded-2xl px-3.5 py-2.5 text-sm text-white"
            >
              <option>Collusion or suspicious play</option>
              <option>Abusive or profane chat</option>
              <option>Intentional stalling / griefing</option>
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReportTarget(null)}
                className="btn-glossy btn-glossy-dark flex-1 py-2.5 rounded-full text-xs font-semibold text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmitReport()}
                className="btn-glossy btn-glossy-pink flex-1 py-2.5 rounded-full text-xs font-bold text-white"
              >
                Submit Report
              </button>
            </div>
          </div>
        </div>
      )}
      {showReplay && lastReplay && (
        <div role="dialog" aria-modal="true" aria-label="Replay last poker hand"
          className="fixed inset-0 z-[75] bg-black/85 backdrop-blur-sm p-4 flex items-center justify-center"
          onClick={() => setShowReplay(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="neon-casino-panel w-full max-w-xl rounded-[32px] p-4 sm:p-6 space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex justify-between items-center gap-3">
              <div>
                <h3 className="font-display font-extrabold text-amber-300 text-lg">Hand #{lastReplay.handNumber} Replay</h3>
                <p className="text-xs text-slate-400">Cards are revealed in order, based on the final public table state.</p>
              </div>
              <button type="button" onClick={() => setShowReplay(false)} aria-label="Close replay"
                className="btn-glossy btn-glossy-dark rounded-full w-9 h-9 grid place-items-center"><X size={17}/></button>
            </div>
            <div className="casino-felt rounded-[28px] border-4 border-amber-600/70 p-6 text-center space-y-4">
              <div className="flex items-center justify-center gap-1.5 min-h-20">
                {lastReplay.communityCards.map((card, index) => (
                  <div key={index}>
                    <PlayingCard card={card} size="sm" faceDown={index >= replayStep}/>
                  </div>
                ))}
              </div>
              <div className="text-amber-200 font-bold text-sm">{lastReplay.headline}</div>
              <p className="text-emerald-200 text-xs">{lastReplay.subtitle}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {lastReplay.seats.filter(s=>!s.folded && s.revealedCards?.length).map((s) => (
                <div key={s.userId} className="input-bubbly p-2.5 rounded-xl">
                  <p className="text-xs text-slate-200 truncate mb-2">{s.username}</p>
                  <div className="flex gap-1">
                    {s.revealedCards?.map((card, index) => <PlayingCard key={index} card={card} size="xs"/>)}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => setReplayStep(0)}
                className="btn-glossy btn-glossy-blue text-xs font-bold rounded-full px-4 py-2 text-white">Replay again</button>
              <button type="button" onClick={() => setReplayStep(5)}
                className="btn-glossy btn-glossy-dark text-xs font-bold rounded-full px-4 py-2 text-white">Show all cards</button>
            </div>
            <p className="text-xs text-slate-400">Session replay only. Hidden or folded opponents' cards are never included.</p>
          </div>
        </div>
      )}
      {viewPlayerId && <PlayerCardModal playerId={viewPlayerId} onClose={() => setViewPlayerId(null)} />}
    </div>
  );
};
