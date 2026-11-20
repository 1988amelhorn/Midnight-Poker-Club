import React, { useEffect, useRef, useState } from 'react';
import { PokerTableEngine } from '../shared/pokerEngine.ts';
import { choosePokerBotAction } from '../shared/pokerBotAi.ts';
import type { Card, PokerActionType, PokerTableView } from '../shared/types.ts';

// Practice is completely local: no server requests, real chips, or other players.
const PLAYER = 'local-practice-player';
const BOT_NAMES = ['Vega', 'Maverick', 'Luna', 'Cipher', 'Nova'];
const STARTING_STACK = 2500;
const SUITS: Record<Card['suit'], string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const LABELS: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const money = (n: number) => Math.round(n).toLocaleString();

function CardFace({ card, hidden = false }: { card?: Card; hidden?: boolean }) {
  if (hidden || !card) {
    return <span className="inline-flex h-14 w-10 items-center justify-center rounded-lg border border-amber-400 bg-gradient-to-br from-red-700 to-slate-950 text-amber-200 shadow-lg">♠</span>;
  }
  const red = card.suit === 'h' || card.suit === 'd';
  return <span className={`inline-flex h-14 w-10 flex-col items-center justify-center rounded-lg border-2 border-slate-200 bg-white font-extrabold shadow-lg ${red ? 'text-red-600' : 'text-slate-950'}`}>
    <span>{LABELS[card.rank] ?? card.rank}</span><span>{SUITS[card.suit]}</span>
  </span>;
}

function createPracticeEngine() {
  const engine = new PokerTableEngine({
    roomId: 'local-bot-practice', smallBlind: 25, bigBlind: 50,
    gameSpeed: 'normal', allowProbabilityAssist: false, turnTimeoutMs: 600_000,
  });
  engine.addPlayer(PLAYER, 'You', 'ace-spade', STARTING_STACK, 0);
  BOT_NAMES.forEach((name, index) => engine.addPlayer(
    `practice-bot-${index}`, name, 'king-gold', STARTING_STACK, index + 1,
    { isBot: true, botDifficulty: 'normal' },
  ));
  engine.startNewHand();
  return engine;
}

export const OfflinePokerPracticeView: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const engineRef = useRef<PokerTableEngine | null>(null);
  if (!engineRef.current) engineRef.current = createPracticeEngine();
  const engine = engineRef.current;
  const [state, setState] = useState<PokerTableView>(() => engine.toPlayerView(PLAYER));
  const [error, setError] = useState<string | null>(null);
  const [betTo, setBetTo] = useState(100);
  const update = () => setState(engine.toPlayerView(PLAYER));

  useEffect(() => {
    if (state.street === 'showdown' || state.street === 'waiting') {
      const timer = window.setTimeout(() => {
        // Local practice chips replenish whenever too few players remain.
        // Account balances are never read or written.
        const playable = engine.seats.filter(s => s.chips > 0).length;
        if (playable < 2 || (engine.seats.find(s => s.userId === PLAYER)?.chips ?? 0) <= 0) {
          engine.seats.forEach(s => { s.chips = STARTING_STACK; s.sittingOut = false; });
        }
        engine.startNewHand();
        setError(null);
        update();
      }, 3600);
      return () => window.clearTimeout(timer);
    }
    const turn = engine.seats.find(s => s.userId === engine.currentTurnUserId);
    if (!turn?.isBot) return;
    const timer = window.setTimeout(() => {
      const legal = engine.getLegalActions(turn.userId);
      if (!legal) return update();
      const decision = choosePokerBotAction({
        holeCards: turn.holeCards, communityCards: engine.communityCards,
        street: engine.street, pot: engine.pot, currentBet: engine.currentBet,
        smallBlind: engine.smallBlind, bigBlind: engine.bigBlind,
        legalActions: legal,
        selfSeat: {
          userId: turn.userId, seatIndex: turn.seatIndex, chips: turn.chips,
          currentBet: turn.currentBet, totalBetThisHand: turn.totalBetThisHand,
          isDealer: turn.isDealer, isSmallBlind: turn.isSmallBlind, isBigBlind: turn.isBigBlind,
        },
        seats: engine.seats.map(s => ({
          userId: s.userId, seatIndex: s.seatIndex, chips: s.chips,
          currentBet: s.currentBet, folded: s.folded, allIn: s.allIn,
          sittingOut: s.sittingOut, isDealer: s.isDealer,
          isSmallBlind: s.isSmallBlind, isBigBlind: s.isBigBlind,
        })),
        actionLog: engine.actionLog,
        difficulty: 'normal',
      });
      const result = engine.applyAction(turn.userId, decision.action, decision.amount);
      if (!result.ok) {
        engine.applyAction(turn.userId, legal.canCheck ? 'check' : legal.canCall ? 'call' : 'fold');
      }
      update();
    }, 600 + Math.floor(Math.random() * 550));
    return () => window.clearTimeout(timer);
  }, [engine, state.stateVersion, state.street]);

  const act = (action: PokerActionType, amount?: number) => {
    setError(null);
    const result = engine.applyAction(PLAYER, action, amount);
    if (!result.ok) setError(result.error || 'Action unavailable');
    update();
  };
  const legal = state.legalActions;
  const me = state.seats.find(s => s.userId === PLAYER);
  const isMyTurn = state.currentTurnUserId === PLAYER && !!legal;
  const winnerText = state.winners.length
    ? state.winners.map(w => `${w.username} wins ${money(w.amount)} (${w.handCategory})`).join(' · ')
    : '';
  const raiseMinimum = legal?.minBetOrRaiseTo ?? 100;
  const raiseMaximum = legal?.maxBetOrRaiseTo ?? 100;
  const desiredBet = Math.max(raiseMinimum, Math.min(raiseMaximum, betTo));

  return <div className="min-h-[75dvh] mx-auto max-w-4xl px-3 py-4 text-white">
    <div className="flex items-center justify-between gap-3 mb-3">
      <button type="button" onClick={onExit} className="btn-glossy btn-glossy-dark rounded-full px-4 py-2 font-bold">← Lobby</button>
      <div className="text-right">
        <div className="text-amber-300 font-extrabold">♠ PRACTICE POKER</div>
        <div className="text-xs text-slate-300">Solo vs 5 bots · Free play · No real chips</div>
      </div>
    </div>
    <div className="rounded-[32px] border-[7px] border-amber-700 bg-gradient-to-b from-emerald-800 via-emerald-950 to-slate-950 shadow-2xl p-3 sm:p-6">
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-6">
        {state.seats.filter(s => s.userId !== PLAYER).map(seat => <div key={seat.userId}
          className={`rounded-2xl border p-2 text-center text-xs bg-black/40 ${seat.isCurrentTurn ? 'border-yellow-300 shadow-[0_0_12px_#facc15]' : 'border-white/20'} ${seat.folded ? 'opacity-50' : ''}`}>
          <div className="font-bold truncate">{seat.username} {seat.isDealer ? 'Ⓓ' : ''}</div>
          <div className="text-amber-300">{money(seat.chips)} chips</div>
          <div className="flex justify-center gap-1 my-2">
            {Array.from({ length: seat.cardCount }, (_, i) => <CardFace key={i} card={seat.holeCards?.[i]} hidden={!seat.holeCards?.[i]} />)}
          </div>
          <div className="text-slate-200 truncate">{seat.lastAction || (seat.folded ? 'Folded' : '')}</div>
        </div>)}
      </div>
      <div className="text-center space-y-2">
        <div className="text-xs uppercase tracking-widest text-amber-200">{state.street} · Hand #{state.handNumber}</div>
        <div className="text-2xl font-extrabold text-yellow-300">Pot: {money(state.pot)}</div>
        <div className="flex justify-center gap-1 min-h-14">
          {Array.from({ length: 5 }, (_, i) => state.communityCards[i]
            ? <CardFace key={i} card={state.communityCards[i]} />
            : <span key={i} className="h-14 w-10 rounded-lg border border-white/20 bg-black/20" />)}
        </div>
        {winnerText && <div className="rounded-xl bg-amber-400/20 border border-amber-400 p-3 font-bold text-amber-100" role="status">{winnerText}</div>}
      </div>
      <div className={`mt-7 mx-auto max-w-sm rounded-2xl border-2 p-3 bg-black/50 text-center ${isMyTurn ? 'border-yellow-300 shadow-[0_0_18px_#eab30866]' : 'border-white/20'}`}>
        <div className="font-extrabold">YOUR HAND {me?.isDealer ? 'Ⓓ' : ''}</div>
        <div className="flex justify-center gap-2 my-2">{me?.holeCards?.map((card, i) => <CardFace key={i} card={card} />)}</div>
        <div className="text-amber-300 font-bold">{money(me?.chips ?? 0)} practice chips</div>
        <div className="text-xs text-slate-300">{isMyTurn ? 'Your turn!' : state.street === 'showdown' ? 'Next hand shortly…' : 'Waiting for bots…'}</div>
      </div>
    </div>
    <div className="mt-4 space-y-3 rounded-3xl border border-amber-500/30 bg-slate-950/80 p-4">
      {error && <p role="alert" className="text-rose-300">{error}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" disabled={!isMyTurn || !legal?.canFold} onClick={() => act('fold')} className="btn-glossy btn-glossy-dark rounded-full px-5 py-3 disabled:opacity-30">Fold</button>
        <button type="button" disabled={!isMyTurn || !legal?.canCheck} onClick={() => act('check')} className="btn-glossy btn-glossy-blue rounded-full px-5 py-3 disabled:opacity-30">Check</button>
        <button type="button" disabled={!isMyTurn || !legal?.canCall} onClick={() => act('call')} className="btn-glossy btn-glossy-green rounded-full px-5 py-3 disabled:opacity-30">Call {money(legal?.callAmount ?? 0)}</button>
        <button type="button" disabled={!isMyTurn || !(legal?.canBet || legal?.canRaise)} onClick={() => act(legal?.canRaise ? 'raise' : 'bet', desiredBet)} className="btn-glossy btn-glossy-gold rounded-full px-5 py-3 disabled:opacity-30">{legal?.canRaise ? 'Raise to' : 'Bet'} {money(desiredBet)}</button>
        <button type="button" disabled={!isMyTurn || !legal?.canAllIn} onClick={() => act('all_in')} className="btn-glossy btn-glossy-purple rounded-full px-5 py-3 disabled:opacity-30">All In</button>
      </div>
      {isMyTurn && (legal?.canRaise || legal?.canBet) && <label className="flex items-center justify-center gap-3 text-sm">
        Bet amount <input aria-label="Bet or raise total" type="number" inputMode="numeric" min={raiseMinimum} max={raiseMaximum}
          className="w-28 rounded-lg bg-slate-800 border border-white/30 p-2" value={betTo}
          onChange={e => setBetTo(Number(e.target.value) || raiseMinimum)} />
        <span className="text-xs text-slate-400">Min {money(raiseMinimum)}</span>
      </label>}
      <p className="text-center text-xs text-slate-400">Temporary practice mode works on this device only. Your live account balance is never changed.</p>
    </div>
  </div>;
};
