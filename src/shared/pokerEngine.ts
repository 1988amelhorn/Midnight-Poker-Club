import { randomInt } from 'node:crypto';
import { calculateHandStrengthAndOdds, evaluateBestHand } from './pokerEvaluator.ts';
import type {
  BotDifficulty,
  Card,
  GameSpeed,
  PokerActionType,
  PokerLegalActions,
  PokerSeatPublic,
  PokerSidePot,
  PokerStreet,
  PokerTableView,
  PokerWinnerDisplay,
  Rank,
  Suit,
} from './types.ts';

export interface InternalPokerSeat {
  seatIndex: number;
  userId: string;
  username: string;
  avatarId: string;
  chips: number;
  holeCards: Card[];
  currentBet: number;
  totalBetThisHand: number;
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
  disconnected: boolean;
  isBot?: boolean;
  botDifficulty?: BotDifficulty;
  hasActedThisRound: boolean;
  lastFullRaiseSeen: number;
  lastAction?: string;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isWinner: boolean;
  wonAmount?: number;
  winningHandName?: string;
  winningCards?: Card[];
}

export interface PokerConfig {
  roomId: string;
  smallBlind: number;
  bigBlind: number;
  ante?: number;
  gameSpeed: GameSpeed;
  allowProbabilityAssist: boolean;
  isTournament?: boolean;
  turnTimeoutMs?: number;
}

export function createShuffledDeck(): Card[] {
  const suits: Suit[] = ['s', 'h', 'd', 'c'];
  const ranks: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

export function calculateSidePots(seats: Array<{ userId: string; totalBetThisHand: number; folded: boolean }>): PokerSidePot[] {
  const levels = Array.from(
    new Set(seats.filter((s) => s.totalBetThisHand > 0).map((s) => s.totalBetThisHand))
  ).sort((a, b) => a - b);

  if (levels.length === 0) return [];

  const rawSlices: PokerSidePot[] = [];
  let prev = 0;
  for (const level of levels) {
    let sliceAmount = 0;
    const eligibleUserIds: string[] = [];
    for (const seat of seats) {
      const contribution = Math.max(0, Math.min(seat.totalBetThisHand, level) - prev);
      sliceAmount += contribution;
      if (!seat.folded && seat.totalBetThisHand >= level) {
        eligibleUserIds.push(seat.userId);
      }
    }
    if (sliceAmount > 0 && eligibleUserIds.length > 0) {
      rawSlices.push({ amount: sliceAmount, eligibleUserIds });
    } else if (sliceAmount > 0 && rawSlices.length > 0) {
      // Folded player bet higher than remaining active players (shouldn't happen normally, attach to previous)
      rawSlices[rawSlices.length - 1].amount += sliceAmount;
    }
    prev = level;
  }

  // Merge consecutive pots with identical eligible player sets
  const merged: PokerSidePot[] = [];
  for (const slice of rawSlices) {
    const key = slice.eligibleUserIds.slice().sort().join(',');
    const last = merged[merged.length - 1];
    if (last && last.eligibleUserIds.slice().sort().join(',') === key) {
      last.amount += slice.amount;
    } else {
      merged.push({ amount: slice.amount, eligibleUserIds: [...slice.eligibleUserIds] });
    }
  }
  return merged;
}

export class PokerTableEngine {
  public roomId: string;
  public smallBlind: number;
  public bigBlind: number;
  public ante: number;
  public gameSpeed: GameSpeed;
  public allowProbabilityAssist: boolean;
  public isTournament: boolean;
  public turnTimeoutMs: number;

  public handNumber = 0;
  public street: PokerStreet = 'waiting';
  public deck: Card[] = [];
  public communityCards: Card[] = [];
  public pot = 0;
  public sidePots: PokerSidePot[] = [];
  public dealerSeat = -1;
  public currentTurnUserId: string | null = null;
  public turnExpiresAt: number | null = null;
  public nextHandAt: number | null = null;

  public currentBet = 0;
  public minRaiseDelta = 0;
  public raiseSequence = 0;

  public seats: InternalPokerSeat[] = [];
  public winners: PokerWinnerDisplay[] = [];
  public actionLog: Array<{ id: string; userId: string; username: string; text: string; street: string; seq: number }> = [];
  public stateVersion = 1;
  public eventSeq = 1;
  public processedActionIds = new Set<string>();
  public onHandCompleted?: (summary: {
    handNumber: number;
    winners: PokerWinnerDisplay[];
    pot: number;
    communityCards: Card[];
    runoutCardsAdded?: number;
    seatNetChanges: Array<{ userId: string; netChips: number; wonPot: number; handCategory?: string; handDescription?: string; isWinner: boolean }>;
  }) => void;

  private startingStacksThisHand = new Map<string, number>();
  private runoutCardsAdded = 0;

  constructor(config: PokerConfig) {
    this.roomId = config.roomId;
    this.smallBlind = config.smallBlind;
    this.bigBlind = config.bigBlind;
    this.ante = config.ante ?? 0;
    this.gameSpeed = config.gameSpeed;
    this.allowProbabilityAssist = config.allowProbabilityAssist;
    this.isTournament = config.isTournament ?? false;
    this.turnTimeoutMs = config.turnTimeoutMs ?? 30_000;
  }

  public addPlayer(
    userId: string,
    username: string,
    avatarId: string,
    chips: number,
    preferredSeat?: number,
    botOptions?: { isBot?: boolean; botDifficulty?: BotDifficulty }
  ): InternalPokerSeat {
    const existing = this.seats.find((s) => s.userId === userId);
    if (existing) {
      existing.disconnected = false;
      existing.username = username;
      existing.avatarId = avatarId;
      if (botOptions?.isBot !== undefined) existing.isBot = botOptions.isBot;
      if (botOptions?.botDifficulty) existing.botDifficulty = botOptions.botDifficulty;
      if (chips > 0 && this.street === 'waiting') {
        existing.chips = chips;
      }
      this.bumpVersion();
      return existing;
    }

    const occupied = new Set(this.seats.map((s) => s.seatIndex));
    let seatIndex = preferredSeat !== undefined && !occupied.has(preferredSeat) ? preferredSeat : -1;
    if (seatIndex === -1) {
      for (let i = 0; i < 9; i++) {
        if (!occupied.has(i)) {
          seatIndex = i;
          break;
        }
      }
    }
    if (seatIndex === -1) throw new Error('Table is full');

    const seat: InternalPokerSeat = {
      seatIndex,
      userId,
      username,
      avatarId,
      chips,
      holeCards: [],
      currentBet: 0,
      totalBetThisHand: 0,
      folded: this.street !== 'waiting',
      allIn: false,
      sittingOut: false,
      disconnected: false,
      isBot: Boolean(botOptions?.isBot),
      botDifficulty: botOptions?.isBot ? (botOptions.botDifficulty ?? 'normal') : undefined,
      hasActedThisRound: false,
      lastFullRaiseSeen: 0,
      isDealer: false,
      isSmallBlind: false,
      isBigBlind: false,
      isWinner: false,
    };
    this.seats.push(seat);
    this.seats.sort((a, b) => a.seatIndex - b.seatIndex);
    this.bumpVersion();
    return seat;
  }

  public removePlayer(userId: string): number {
    const idx = this.seats.findIndex((s) => s.userId === userId);
    if (idx === -1) return 0;
    const seat = this.seats[idx];
    const remainingChips = seat.chips;

    // If active in a hand, fold them first so turn advances cleanly
    if (this.street !== 'waiting' && this.street !== 'showdown' && !seat.folded) {
      if (this.currentTurnUserId === userId) {
        this.applyAction(userId, 'fold');
      } else {
        seat.folded = true;
        seat.lastAction = 'Left';
      }
    }
    this.seats.splice(idx, 1);
    this.bumpVersion();
    return remainingChips;
  }

  public setSitOut(userId: string, sittingOut: boolean): void {
    const seat = this.seats.find((s) => s.userId === userId);
    if (!seat) return;
    seat.sittingOut = sittingOut;
    if (sittingOut && this.currentTurnUserId === userId && this.street !== 'waiting' && this.street !== 'showdown') {
      this.applyAction(userId, 'fold');
    } else {
      this.bumpVersion();
    }
  }

  public setDisconnected(userId: string, disconnected: boolean): void {
    const seat = this.seats.find((s) => s.userId === userId);
    if (!seat) return;
    seat.disconnected = disconnected;
    this.bumpVersion();
  }

  public canStartHand(): boolean {
    const eligible = this.seats.filter((s) => !s.sittingOut && s.chips > 0);
    return eligible.length >= 2;
  }

  public startNewHand(): boolean {
    // Eliminate busted seats in tournament or mark sittingOut in cash
    for (const s of this.seats) {
      if (s.chips <= 0) {
        s.sittingOut = true;
      }
    }

    const activeSeats = this.seats.filter((s) => !s.sittingOut && s.chips > 0);
    if (activeSeats.length < 2) {
      this.street = 'waiting';
      this.currentTurnUserId = null;
      this.turnExpiresAt = null;
      this.bumpVersion();
      return false;
    }

    this.handNumber += 1;
    this.street = 'preflop';
    this.deck = createShuffledDeck();
    this.communityCards = [];
    this.pot = 0;
    this.sidePots = [];
    this.winners = [];
    this.nextHandAt = null;
    this.currentBet = 0;
    this.minRaiseDelta = this.bigBlind;
    this.raiseSequence = 1;
    this.startingStacksThisHand.clear();

    // Reset seats
    for (const s of this.seats) {
      s.holeCards = [];
      s.currentBet = 0;
      s.totalBetThisHand = 0;
      s.folded = s.sittingOut || s.chips <= 0;
      s.allIn = false;
      s.hasActedThisRound = false;
      s.lastFullRaiseSeen = 0;
      s.lastAction = undefined;
      s.isDealer = false;
      s.isSmallBlind = false;
      s.isBigBlind = false;
      s.isWinner = false;
      s.wonAmount = undefined;
      s.winningHandName = undefined;
      s.winningCards = undefined;
      if (!s.folded) {
        this.startingStacksThisHand.set(s.userId, s.chips);
      }
    }

    // Rotate dealer clockwise among active seats
    const nextDealer = this.findNextSeatAfter(this.dealerSeat, (s) => !s.folded);
    this.dealerSeat = nextDealer!.seatIndex;
    nextDealer!.isDealer = true;

    let sbSeat: InternalPokerSeat;
    let bbSeat: InternalPokerSeat;
    if (activeSeats.length === 2) {
      // Heads-up rule: Dealer is Small Blind
      sbSeat = nextDealer!;
      bbSeat = this.findNextSeatAfter(sbSeat.seatIndex, (s) => !s.folded)!;
    } else {
      sbSeat = this.findNextSeatAfter(this.dealerSeat, (s) => !s.folded)!;
      bbSeat = this.findNextSeatAfter(sbSeat.seatIndex, (s) => !s.folded)!;
    }

    sbSeat.isSmallBlind = true;
    bbSeat.isBigBlind = true;

    // Optional Antes
    if (this.ante > 0) {
      for (const s of activeSeats) {
        const antePosted = Math.min(s.chips, this.ante);
        s.chips -= antePosted;
        s.totalBetThisHand += antePosted;
        this.pot += antePosted;
        if (s.chips === 0) s.allIn = true;
      }
    }

    // Post Blinds
    const sbPosted = Math.min(sbSeat.chips, this.smallBlind);
    sbSeat.chips -= sbPosted;
    sbSeat.currentBet += sbPosted;
    sbSeat.totalBetThisHand += sbPosted;
    this.pot += sbPosted;
    if (sbSeat.chips === 0) sbSeat.allIn = true;
    this.logAction(sbSeat, `Posted SB ${sbPosted}`);

    const bbPosted = Math.min(bbSeat.chips, this.bigBlind);
    bbSeat.chips -= bbPosted;
    bbSeat.currentBet += bbPosted;
    bbSeat.totalBetThisHand += bbPosted;
    this.pot += bbPosted;
    if (bbSeat.chips === 0) bbSeat.allIn = true;
    this.logAction(bbSeat, `Posted BB ${bbPosted}`);

    this.currentBet = Math.max(sbSeat.currentBet, bbSeat.currentBet, this.bigBlind);
    // Deal 2 hole cards clockwise starting from SB
    const dealOrder = this.getClockwiseSeatsStartingFrom(sbSeat.seatIndex).filter((s) => !s.folded);
    for (let round = 0; round < 2; round++) {
      for (const s of dealOrder) {
        s.holeCards.push(this.deck.pop()!);
      }
    }

    // First to act preflop: left of BB (in heads-up, SB/Dealer is left of BB)
    const firstActor = this.findNextSeatAfter(bbSeat.seatIndex, (s) => !s.folded && !s.allIn);
    if (!firstActor || this.countNonFoldedNonAllIn() <= 1 && this.allActiveMatchedOrAllIn()) {
      this.runOutBoardToShowdown();
    } else {
      this.currentTurnUserId = firstActor.userId;
      this.turnExpiresAt = Date.now() + this.turnTimeoutMs;
    }

    this.bumpVersion();
    return true;
  }

  public getLegalActions(userId: string): PokerLegalActions | null {
    if (this.street === 'waiting' || this.street === 'showdown') return null;
    if (this.currentTurnUserId !== userId) return null;
    const seat = this.seats.find((s) => s.userId === userId);
    if (!seat || seat.folded || seat.allIn) return null;

    const toCall = Math.max(0, this.currentBet - seat.currentBet);
    const maxTotalBet = seat.currentBet + seat.chips;
    const canCheck = toCall === 0;
    const canCall = toCall > 0 && seat.chips > 0;
    const callAmount = Math.min(toCall, seat.chips);

    // Did this player already act on the current full raise?
    const alreadyActedOnCurrentRaise = seat.hasActedThisRound && seat.lastFullRaiseSeen === this.raiseSequence;

    const canBet = this.currentBet === 0 && seat.chips > 0;
    const minRaiseTarget = this.currentBet === 0
      ? Math.min(maxTotalBet, this.bigBlind)
      : Math.min(maxTotalBet, this.currentBet + this.minRaiseDelta);

    const canRaise =
      this.currentBet > 0 &&
      !alreadyActedOnCurrentRaise &&
      seat.chips > toCall;

    return {
      canFold: toCall > 0 || !canCheck,
      canCheck,
      canCall,
      callAmount,
      canBet,
      canRaise,
      minBetOrRaiseTo: minRaiseTarget,
      maxBetOrRaiseTo: maxTotalBet,
      canAllIn: seat.chips > 0,
    };
  }

  public applyAction(
    userId: string,
    action: PokerActionType,
    amount?: number,
    actionId?: string
  ): { ok: boolean; error?: string; duplicate?: boolean } {
    if (actionId) {
      if (this.processedActionIds.has(actionId)) {
        return { ok: true, duplicate: true };
      }
    }

    if (this.street === 'waiting' || this.street === 'showdown') {
      return { ok: false, error: 'Hand is not accepting actions right now' };
    }
    if (this.currentTurnUserId !== userId) {
      return { ok: false, error: 'Not your turn' };
    }

    const seat = this.seats.find((s) => s.userId === userId);
    const legal = this.getLegalActions(userId);
    if (!seat || !legal) {
      return { ok: false, error: 'No legal actions available' };
    }

    if (action === 'fold') {
      seat.folded = true;
      seat.hasActedThisRound = true;
      seat.lastAction = 'Fold';
      this.logAction(seat, 'Folded');
    } else if (action === 'check') {
      if (!legal.canCheck) return { ok: false, error: 'Cannot check when facing a bet' };
      seat.hasActedThisRound = true;
      seat.lastFullRaiseSeen = this.raiseSequence;
      seat.lastAction = 'Check';
      this.logAction(seat, 'Checked');
    } else if (action === 'call') {
      if (!legal.canCall) return { ok: false, error: 'Nothing to call' };
      const pay = legal.callAmount;
      seat.chips -= pay;
      seat.currentBet += pay;
      seat.totalBetThisHand += pay;
      this.pot += pay;
      if (seat.chips === 0) seat.allIn = true;
      seat.hasActedThisRound = true;
      seat.lastFullRaiseSeen = this.raiseSequence;
      seat.lastAction = seat.allIn ? `All-In ${seat.currentBet}` : `Call ${pay}`;
      this.logAction(seat, seat.allIn ? `Called all-in (${pay})` : `Called ${pay}`);
    } else if (action === 'bet' || action === 'raise' || action === 'all_in') {
      const targetTotal = action === 'all_in' ? legal.maxBetOrRaiseTo : Math.floor(amount ?? 0);

      if (action === 'bet' && !legal.canBet) {
        return { ok: false, error: 'Cannot open a bet when a bet already exists; use raise' };
      }
      if (action === 'raise' && !legal.canRaise) {
        return { ok: false, error: 'Re-raising is not reopened for your seat' };
      }
      if (targetTotal <= seat.currentBet) {
        return { ok: false, error: 'Bet or raise must exceed your current street bet' };
      }
      if (targetTotal > legal.maxBetOrRaiseTo) {
        return { ok: false, error: 'Bet exceeds available chip stack' };
      }

      const isAllIn = targetTotal === legal.maxBetOrRaiseTo;
      // Enforce minimum legal raise unless going all-in for less
      if (!isAllIn && targetTotal < legal.minBetOrRaiseTo) {
        return { ok: false, error: `Minimum legal ${this.currentBet === 0 ? 'bet' : 'raise'} is ${legal.minBetOrRaiseTo}` };
      }

      const added = targetTotal - seat.currentBet;
      seat.chips -= added;
      seat.currentBet = targetTotal;
      seat.totalBetThisHand += added;
      this.pot += added;
      if (seat.chips === 0) seat.allIn = true;

      if (targetTotal > this.currentBet) {
        const delta = targetTotal - this.currentBet;
        const isFullRaise = delta >= this.minRaiseDelta || this.currentBet === 0;
        if (this.currentBet === 0) {
          this.minRaiseDelta = Math.max(this.bigBlind, delta);
        } else if (isFullRaise) {
          this.minRaiseDelta = delta;
        }
        this.currentBet = targetTotal;
        if (isFullRaise) {
          // Reopen action for all other players
          this.raiseSequence += 1;
          for (const s of this.seats) {
            if (s.userId !== seat.userId && !s.folded && !s.allIn) {
              s.hasActedThisRound = false;
            }
          }
        }
      }

      seat.hasActedThisRound = true;
      seat.lastFullRaiseSeen = this.raiseSequence;
      seat.lastAction = seat.allIn ? `All-In ${targetTotal}` : `${action === 'bet' ? 'Bet' : 'Raise'} ${targetTotal}`;
      this.logAction(seat, seat.allIn ? `Went all-in to ${targetTotal}` : `${action === 'bet' ? 'Bet' : 'Raised to'} ${targetTotal}`);
    } else {
      return { ok: false, error: 'Unknown action' };
    }

    if (actionId) {
      this.processedActionIds.add(actionId);
    }

    this.advanceAfterAction(seat.seatIndex);
    this.bumpVersion();
    return { ok: true };
  }

  private advanceAfterAction(lastSeatIndex: number): void {
    const remaining = this.seats.filter((s) => !s.folded);
    if (remaining.length === 1) {
      // Everyone else folded -> sole survivor wins pot immediately
      this.resolveFoldWin(remaining[0]);
      return;
    }

    if (this.isBettingRoundComplete()) {
      // Reset street bets and move to next street
      if (this.street === 'river') {
        this.resolveShowdown();
        return;
      }

      // If <= 1 non-all-in player remains, run out remaining streets
      if (this.countNonFoldedNonAllIn() <= 1) {
        this.runOutBoardToShowdown();
        return;
      }

      this.advanceStreet();
      return;
    }

    // Find next player who needs to act
    const nextActor = this.findNextSeatAfter(
      lastSeatIndex,
      (s) => !s.folded && !s.allIn && (!s.hasActedThisRound || s.currentBet < this.currentBet)
    );
    if (!nextActor) {
      if (this.street === 'river') {
        this.resolveShowdown();
      } else {
        this.advanceStreet();
      }
      return;
    }

    this.currentTurnUserId = nextActor.userId;
    this.turnExpiresAt = Date.now() + this.turnTimeoutMs;
  }

  private isBettingRoundComplete(): boolean {
    const active = this.seats.filter((s) => !s.folded && !s.allIn);
    if (active.length === 0) return true;
    return active.every((s) => s.hasActedThisRound && s.currentBet === this.currentBet);
  }

  private allActiveMatchedOrAllIn(): boolean {
    const active = this.seats.filter((s) => !s.folded && !s.allIn);
    return active.every((s) => s.currentBet === this.currentBet);
  }

  private countNonFoldedNonAllIn(): number {
    return this.seats.filter((s) => !s.folded && !s.allIn).length;
  }

  private advanceStreet(): void {
    for (const s of this.seats) {
      s.currentBet = 0;
      s.hasActedThisRound = false;
      s.lastFullRaiseSeen = 0;
      if (!s.folded && !s.allIn) {
        s.lastAction = undefined;
      }
    }
    this.currentBet = 0;
    this.minRaiseDelta = this.bigBlind;
    this.raiseSequence = 1;

    if (this.street === 'preflop') {
      this.street = 'flop';
      this.deck.pop(); // burn
      this.communityCards.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!);
    } else if (this.street === 'flop') {
      this.street = 'turn';
      this.deck.pop(); // burn
      this.communityCards.push(this.deck.pop()!);
    } else if (this.street === 'turn') {
      this.street = 'river';
      this.deck.pop(); // burn
      this.communityCards.push(this.deck.pop()!);
    }

    const firstPostflop = this.findNextSeatAfter(this.dealerSeat, (s) => !s.folded && !s.allIn);
    if (!firstPostflop) {
      this.runOutBoardToShowdown();
      return;
    }
    this.currentTurnUserId = firstPostflop.userId;
    this.turnExpiresAt = Date.now() + this.turnTimeoutMs;
  }

  private runOutBoardToShowdown(): void {
    const cardsBefore = this.communityCards.length;
    while (this.communityCards.length < 5) {
      if (this.communityCards.length === 0) {
        this.deck.pop();
        this.communityCards.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!);
      } else {
        this.deck.pop();
        this.communityCards.push(this.deck.pop()!);
      }
    }
    this.runoutCardsAdded = this.communityCards.length - cardsBefore;
    this.resolveShowdown();
  }

  private resolveFoldWin(winner: InternalPokerSeat): void {
    this.street = 'showdown';
    this.currentTurnUserId = null;
    this.turnExpiresAt = null;
    this.sidePots = calculateSidePots(this.seats);

    winner.chips += this.pot;
    winner.isWinner = true;
    winner.wonAmount = this.pot;
    winner.winningHandName = 'Opponents Folded';

    this.winners = [
      {
        userId: winner.userId,
        username: winner.username,
        amount: this.pot,
        handCategory: 'Uncontested',
        handDescription: 'Won uncontested pot',
        bestFiveCards: [],
        potIndex: 0,
      },
    ];

    this.logAction(winner, `Won ${this.pot} (uncontested)`);
    this.emitCompletion();
  }

  private resolveShowdown(): void {
    this.street = 'showdown';
    this.currentTurnUserId = null;
    this.turnExpiresAt = null;
    this.sidePots = calculateSidePots(this.seats);

    const evaluations = new Map<string, ReturnType<typeof evaluateBestHand>>();
    for (const seat of this.seats) {
      if (!seat.folded && seat.holeCards.length === 2) {
        evaluations.set(seat.userId, evaluateBestHand([...seat.holeCards, ...this.communityCards]));
      }
    }

    const totalWonByUser = new Map<string, number>();
    const bestDescByUser = new Map<string, ReturnType<typeof evaluateBestHand>>();
    const winnerList: PokerWinnerDisplay[] = [];

    this.sidePots.forEach((potSlice, potIndex) => {
      let bestScore = -1;
      let potWinners: InternalPokerSeat[] = [];

      for (const uid of potSlice.eligibleUserIds) {
        const seat = this.seats.find((s) => s.userId === uid);
        const ev = evaluations.get(uid);
        if (!seat || !ev) continue;

        if (ev.score > bestScore) {
          bestScore = ev.score;
          potWinners = [seat];
        } else if (ev.score === bestScore) {
          potWinners.push(seat);
        }
      }

      if (potWinners.length === 0) return;

      // Order winners clockwise starting left of dealer button for odd chip distribution
      const orderedWinners = this.getClockwiseSeatsStartingFrom(this.dealerSeat + 1).filter((s) =>
        potWinners.some((w) => w.userId === s.userId)
      );

      const baseShare = Math.floor(potSlice.amount / orderedWinners.length);
      let oddChips = potSlice.amount % orderedWinners.length;

      for (const w of orderedWinners) {
        const share = baseShare + (oddChips > 0 ? 1 : 0);
        if (oddChips > 0) oddChips -= 1;

        w.chips += share;
        totalWonByUser.set(w.userId, (totalWonByUser.get(w.userId) ?? 0) + share);
        const ev = evaluations.get(w.userId)!;
        bestDescByUser.set(w.userId, ev);

        winnerList.push({
          userId: w.userId,
          username: w.username,
          amount: share,
          handCategory: ev.category,
          handDescription: ev.description,
          bestFiveCards: ev.bestFiveCards,
          potIndex,
        });
      }
    });

    for (const [uid, totalWon] of totalWonByUser.entries()) {
      const seat = this.seats.find((s) => s.userId === uid)!;
      const ev = bestDescByUser.get(uid)!;
      seat.isWinner = true;
      seat.wonAmount = totalWon;
      seat.winningHandName = ev.description;
      seat.winningCards = ev.bestFiveCards;
      this.logAction(seat, `Won ${totalWon} with ${ev.description}`);
    }

    this.winners = winnerList;
    this.emitCompletion();
  }

  private emitCompletion(): void {
    if (!this.onHandCompleted) return;
    const seatNetChanges = Array.from(this.startingStacksThisHand.entries()).map(([userId, startStack]) => {
      const seat = this.seats.find((s) => s.userId === userId);
      const endStack = seat ? seat.chips : 0;
      const won = seat?.wonAmount ?? 0;
      const winnerRecord = this.winners.find((w) => w.userId === userId);
      return {
        userId,
        netChips: endStack - startStack,
        wonPot: won,
        handCategory: winnerRecord?.handCategory,
        handDescription: winnerRecord?.handDescription,
        isWinner: Boolean(seat?.isWinner),
      };
    });

    this.onHandCompleted({
      handNumber: this.handNumber,
      winners: this.winners,
      pot: this.pot,
      communityCards: [...this.communityCards],
      runoutCardsAdded: this.runoutCardsAdded,
      seatNetChanges,
    });
    this.runoutCardsAdded = 0;
  }

  private findNextSeatAfter(startSeatIndex: number, predicate: (s: InternalPokerSeat) => boolean): InternalPokerSeat | null {
    const ordered = this.getClockwiseSeatsStartingFrom(startSeatIndex + 1);
    return ordered.find(predicate) ?? null;
  }

  private getClockwiseSeatsStartingFrom(startSeatIndex: number): InternalPokerSeat[] {
    const normStart = ((startSeatIndex % 9) + 9) % 9;
    const result: InternalPokerSeat[] = [];
    for (let offset = 0; offset < 9; offset++) {
      const idx = (normStart + offset) % 9;
      const seat = this.seats.find((s) => s.seatIndex === idx);
      if (seat) result.push(seat);
    }
    return result;
  }

  private logAction(seat: InternalPokerSeat, text: string): void {
    this.actionLog.push({
      id: `${this.handNumber}-${this.eventSeq}`,
      userId: seat.userId,
      username: seat.username,
      text,
      street: this.street,
      seq: this.eventSeq,
    });
    if (this.actionLog.length > 40) {
      this.actionLog.shift();
    }
  }

  private bumpVersion(): void {
    this.stateVersion += 1;
    this.eventSeq += 1;
  }

  /**
   * Generates a strict private per-player view.
   * Never leaks opponents' hole cards before showdown (or if won uncontested by folding).
   */
  public toPlayerView(viewerUserId: string | null): PokerTableView {
    const isShowdownReveal =
      this.street === 'showdown' && this.seats.filter((s) => !s.folded).length > 1;

    const publicSeats: PokerSeatPublic[] = this.seats.map((s) => {
      const canSeeCards =
        s.userId === viewerUserId ||
        (isShowdownReveal && !s.folded);

      return {
        seatIndex: s.seatIndex,
        userId: s.userId,
        username: s.username,
        avatarId: s.avatarId,
        chips: s.chips,
        currentBet: s.currentBet,
        totalBetThisHand: s.totalBetThisHand,
        folded: s.folded,
        allIn: s.allIn,
        sittingOut: s.sittingOut,
        disconnected: s.disconnected,
        isBot: Boolean(s.isBot),
        botDifficulty: s.botDifficulty,
        lastAction: s.lastAction,
        holeCards: canSeeCards ? [...s.holeCards] : null,
        cardCount: s.holeCards.length,
        isDealer: s.isDealer,
        isSmallBlind: s.isSmallBlind,
        isBigBlind: s.isBigBlind,
        isCurrentTurn: this.currentTurnUserId === s.userId,
        isWinner: s.isWinner,
        wonAmount: s.wonAmount,
        winningHandName: s.winningHandName,
        winningCards: s.winningCards,
      };
    });

    const viewerSeat = viewerUserId ? this.seats.find((s) => s.userId === viewerUserId) : undefined;
    const activeOpponents = this.seats.filter((s) => s.userId !== viewerUserId && !s.folded && s.holeCards.length === 2).length;
    const handStrength =
      viewerSeat && viewerSeat.holeCards.length === 2 && !viewerSeat.folded
        ? calculateHandStrengthAndOdds(
            viewerSeat.holeCards,
            this.communityCards,
            Math.max(1, activeOpponents),
            240
          )
        : null;

    return {
      roomId: this.roomId,
      handNumber: this.handNumber,
      street: this.street,
      communityCards: [...this.communityCards],
      pot: this.pot,
      sidePots: this.sidePots.length > 0 ? this.sidePots : calculateSidePots(this.seats),
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      ante: this.ante,
      dealerSeat: this.dealerSeat,
      currentTurnUserId: this.currentTurnUserId,
      turnExpiresAt: this.turnExpiresAt,
      minRaiseTo: this.currentBet + this.minRaiseDelta,
      currentBet: this.currentBet,
      gameSpeed: this.gameSpeed,
      allowProbabilityAssist: this.allowProbabilityAssist,
      seats: publicSeats,
      winners: this.winners,
      actionLog: [...this.actionLog],
      legalActions: viewerUserId ? this.getLegalActions(viewerUserId) : null,
      handStrength: this.allowProbabilityAssist ? handStrength : (handStrength ? {
        ...handStrength,
        winProbability: 0,
        summaryHint: 'Probability assist disabled by host',
        categoryOdds: [],
        simulations: 0,
      } : null),
      stateVersion: this.stateVersion,
      eventSeq: this.eventSeq,
      nextHandAt: this.nextHandAt,
    };
  }
}
