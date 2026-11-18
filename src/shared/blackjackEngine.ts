import { randomInt } from 'node:crypto';
import type {
  BlackjackActionType,
  BlackjackHandState,
  BlackjackPhase,
  BlackjackSeatView,
  BlackjackTableView,
  Card,
  GameSpeed,
  Rank,
  Suit,
} from './types.ts';

export function createMultiDeckShoe(numDecks = 6): Card[] {
  const suits: Suit[] = ['s', 'h', 'd', 'c'];
  const ranks: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const shoe: Card[] = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        shoe.push({ rank, suit });
      }
    }
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const tmp = shoe[i];
    shoe[i] = shoe[j];
    shoe[j] = tmp;
  }
  return shoe;
}

export function scoreBlackjackHand(cards: Card[]): { score: number; isSoft: boolean; isBust: boolean; isBlackjack: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 14) {
      total += 11;
      aces += 1;
    } else if (c.rank >= 10) {
      total += 10;
    } else {
      total += c.rank;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  const isSoft = aces > 0 && total <= 21;
  const isBust = total > 21;
  const isBlackjack = cards.length === 2 && total === 21;
  return { score: total, isSoft, isBust, isBlackjack };
}

export function getCardBlackjackValue(card: Card): number {
  if (card.rank === 14) return 11;
  if (card.rank >= 10) return 10;
  return card.rank;
}

export interface InternalBlackjackSeat {
  seatIndex: number;
  userId: string;
  username: string;
  avatarId: string;
  tableChips: number;
  hands: BlackjackHandState[];
  activeHandIndex: number;
  insuranceBet: number;
  insuranceDecided: boolean;
  betPlaced: boolean;
  disconnected: boolean;
}

export class BlackjackTableEngine {
  public roomId: string;
  public minBet: number;
  public maxBet: number;
  public gameSpeed: GameSpeed;
  public roundNumber = 0;
  public phase: BlackjackPhase = 'betting';
  public shoe: Card[];
  public dealerCards: Card[] = [];
  public seats: InternalBlackjackSeat[] = [];
  public currentTurnUserId: string | null = null;
  public currentTurnHandIndex = 0;
  public turnExpiresAt: number | null = null;
  public nextRoundAt: number | null = null;
  public stateVersion = 1;
  public eventSeq = 1;
  public processedActionIds = new Set<string>();

  public onRoundSettled?: (summary: {
    roundNumber: number;
    dealerCards: Card[];
    dealerScore: number;
    seatResults: Array<{
      userId: string;
      totalWagered: number;
      totalPayout: number;
      netChips: number;
      hadBlackjack: boolean;
      handsWon: number;
      handsPlayed: number;
    }>;
  }) => void;

  constructor(config: { roomId: string; minBet?: number; maxBet?: number; gameSpeed: GameSpeed }) {
    this.roomId = config.roomId;
    this.minBet = config.minBet ?? 25;
    this.maxBet = config.maxBet ?? 1000;
    this.gameSpeed = config.gameSpeed;
    this.shoe = createMultiDeckShoe(6);
  }

  public addPlayer(userId: string, username: string, avatarId: string, chips: number): InternalBlackjackSeat {
    const existing = this.seats.find((s) => s.userId === userId);
    if (existing) {
      existing.disconnected = false;
      existing.username = username;
      existing.avatarId = avatarId;
      this.bump();
      return existing;
    }
    if (this.seats.length >= 7) {
      throw new Error('Blackjack table is full (max 7 seats)');
    }
    const occupied = new Set(this.seats.map((s) => s.seatIndex));
    let seatIndex = 0;
    while (occupied.has(seatIndex) && seatIndex < 7) seatIndex++;

    const seat: InternalBlackjackSeat = {
      seatIndex,
      userId,
      username,
      avatarId,
      tableChips: chips,
      hands: [],
      activeHandIndex: 0,
      insuranceBet: 0,
      insuranceDecided: false,
      betPlaced: false,
      disconnected: false,
    };
    this.seats.push(seat);
    this.seats.sort((a, b) => a.seatIndex - b.seatIndex);
    this.bump();
    return seat;
  }

  public removePlayer(userId: string): number {
    const idx = this.seats.findIndex((s) => s.userId === userId);
    if (idx === -1) return 0;
    const seat = this.seats[idx];
    const remaining = seat.tableChips;
    if (this.currentTurnUserId === userId && this.phase === 'player_turns') {
      this.applyAction(userId, 'stand');
    }
    this.seats.splice(idx, 1);
    if (this.seats.length === 0) {
      this.phase = 'betting';
      this.dealerCards = [];
      this.currentTurnUserId = null;
    }
    this.bump();
    return remaining;
  }

  public startNewBettingRound(): void {
    if (this.shoe.length < 60) {
      this.shoe = createMultiDeckShoe(6);
    }
    this.phase = 'betting';
    this.dealerCards = [];
    this.currentTurnUserId = null;
    this.currentTurnHandIndex = 0;
    this.turnExpiresAt = null;
    this.nextRoundAt = null;
    for (const seat of this.seats) {
      seat.hands = [];
      seat.activeHandIndex = 0;
      seat.insuranceBet = 0;
      seat.insuranceDecided = false;
      seat.betPlaced = false;
    }
    this.bump();
  }

  public applyAction(
    userId: string,
    action: BlackjackActionType,
    amount?: number,
    actionId?: string
  ): { ok: boolean; error?: string; duplicate?: boolean } {
    if (actionId && this.processedActionIds.has(actionId)) {
      return { ok: true, duplicate: true };
    }

    const seat = this.seats.find((s) => s.userId === userId);
    if (!seat) return { ok: false, error: 'Seat not found' };

    if (action === 'place_bet') {
      if (this.phase !== 'betting' && this.phase !== 'settled') {
        return { ok: false, error: 'Betting is closed for this round' };
      }
      if (this.phase === 'settled') {
        this.startNewBettingRound();
      }
      const bet = Math.floor(amount ?? this.minBet);
      if (bet < this.minBet || bet > this.maxBet) {
        return { ok: false, error: `Bet must be between ${this.minBet} and ${this.maxBet}` };
      }
      if (seat.betPlaced) {
        return { ok: false, error: 'Bet already placed for this round' };
      }
      if (seat.tableChips < bet) {
        return { ok: false, error: 'Insufficient table chips' };
      }

      seat.tableChips -= bet;
      seat.betPlaced = true;
      seat.hands = [
        {
          handIndex: 0,
          cards: [],
          bet,
          score: 0,
          isSoft: false,
          isBust: false,
          isBlackjack: false,
          isStood: false,
          isDoubled: false,
          isSplitAce: false,
          payout: 0,
        },
      ];
      seat.activeHandIndex = 0;
      if (actionId) this.processedActionIds.add(actionId);

      // Deal immediately if all active seated players have placed bets (or solo player)
      const activeSeatsWithChips = this.seats.filter((s) => s.betPlaced || s.tableChips >= this.minBet);
      if (activeSeatsWithChips.length > 0 && activeSeatsWithChips.every((s) => s.betPlaced)) {
        this.dealInitialCards();
      } else {
        this.bump();
      }
      return { ok: true };
    }

    if (action === 'insurance_accept' || action === 'insurance_decline') {
      if (this.phase !== 'insurance') return { ok: false, error: 'Insurance is not open' };
      if (!seat.betPlaced || seat.insuranceDecided) return { ok: false, error: 'Insurance already resolved' };
      if (action === 'insurance_accept') {
        const insCost = Math.floor(seat.hands[0].bet / 2);
        if (seat.tableChips < insCost) return { ok: false, error: 'Insufficient chips for insurance' };
        seat.tableChips -= insCost;
        seat.insuranceBet = insCost;
      }
      seat.insuranceDecided = true;
      if (actionId) this.processedActionIds.add(actionId);

      if (this.seats.filter((s) => s.betPlaced).every((s) => s.insuranceDecided)) {
        this.resolveDealerPeekAfterInsurance();
      } else {
        this.bump();
      }
      return { ok: true };
    }

    if (this.phase !== 'player_turns') {
      return { ok: false, error: 'Not in player turn phase' };
    }
    if (this.currentTurnUserId !== userId) {
      return { ok: false, error: 'Not your turn' };
    }

    const hand = seat.hands[seat.activeHandIndex];
    if (!hand || hand.isStood || hand.isBust) {
      return { ok: false, error: 'Hand is already complete' };
    }

    if (action === 'hit') {
      if (hand.isSplitAce) {
        return { ok: false, error: 'Split Aces receive one card each' };
      }
      hand.cards.push(this.drawCard());
      this.recalcHand(hand);
      if (hand.isBust || hand.score === 21) {
        hand.isStood = true;
        this.advancePlayerTurn();
      } else {
        this.turnExpiresAt = Date.now() + 25_000;
      }
    } else if (action === 'stand') {
      hand.isStood = true;
      this.advancePlayerTurn();
    } else if (action === 'double') {
      if (hand.cards.length !== 2) {
        return { ok: false, error: 'Can only double down on initial two cards' };
      }
      if (hand.isSplitAce) {
        return { ok: false, error: 'Cannot double split Aces' };
      }
      if (seat.tableChips < hand.bet) {
        return { ok: false, error: 'Insufficient chips to double down' };
      }
      seat.tableChips -= hand.bet;
      hand.bet *= 2;
      hand.isDoubled = true;
      hand.cards.push(this.drawCard());
      this.recalcHand(hand);
      hand.isStood = true;
      this.advancePlayerTurn();
    } else if (action === 'split') {
      if (hand.cards.length !== 2) {
        return { ok: false, error: 'Can only split a two-card hand' };
      }
      if (seat.hands.length >= 4) {
        return { ok: false, error: 'Maximum of 4 hands reached after splitting' };
      }
      const v1 = getCardBlackjackValue(hand.cards[0]);
      const v2 = getCardBlackjackValue(hand.cards[1]);
      if (v1 !== v2) {
        return { ok: false, error: 'Cards must have equal value to split' };
      }
      if (seat.tableChips < hand.bet) {
        return { ok: false, error: 'Insufficient chips to split' };
      }

      const splittingAces = hand.cards[0].rank === 14;
      seat.tableChips -= hand.bet;
      const secondCard = hand.cards.pop()!;
      hand.cards.push(this.drawCard());
      hand.isSplitAce = splittingAces;
      this.recalcHand(hand);
      if (splittingAces) {
        hand.isStood = true;
      }

      const newHand: BlackjackHandState = {
        handIndex: seat.hands.length,
        cards: [secondCard, this.drawCard()],
        bet: hand.bet,
        score: 0,
        isSoft: false,
        isBust: false,
        isBlackjack: false,
        isStood: splittingAces,
        isDoubled: false,
        isSplitAce: splittingAces,
        payout: 0,
      };
      this.recalcHand(newHand);
      seat.hands.push(newHand);
      // Re-index
      seat.hands.forEach((h, idx) => { h.handIndex = idx; });

      // Note: Split 21 is NOT natural blackjack (pays 1:1)
      hand.isBlackjack = false;
      newHand.isBlackjack = false;

      if (splittingAces) {
        this.advancePlayerTurn();
      } else {
        this.turnExpiresAt = Date.now() + 25_000;
      }
    } else {
      return { ok: false, error: 'Invalid Blackjack action' };
    }

    if (actionId) this.processedActionIds.add(actionId);
    this.bump();
    return { ok: true };
  }

  public dealInitialCards(): void {
    if (this.shoe.length < 52) {
      this.shoe = createMultiDeckShoe(6);
    }
    this.roundNumber += 1;
    const bettors = this.seats.filter((s) => s.betPlaced);
    if (bettors.length === 0) return;

    this.dealerCards = [];
    for (let r = 0; r < 2; r++) {
      for (const s of bettors) {
        s.hands[0].cards.push(this.drawCard());
      }
      this.dealerCards.push(this.drawCard());
    }

    for (const s of bettors) {
      this.recalcHand(s.hands[0]);
      if (s.hands[0].isBlackjack) {
        s.hands[0].isStood = true;
      }
    }

    const upcard = this.dealerCards[0];
    // Insurance offered if dealer shows Ace
    if (upcard.rank === 14) {
      this.phase = 'insurance';
      this.currentTurnUserId = null;
      this.turnExpiresAt = Date.now() + 15_000;
      this.bump();
      return;
    }

    // Dealer peeks on 10-value upcard
    if (getCardBlackjackValue(upcard) === 10) {
      const dealerEval = scoreBlackjackHand(this.dealerCards);
      if (dealerEval.isBlackjack) {
        this.settleRound();
        return;
      }
    }

    this.beginPlayerTurns();
  }

  private resolveDealerPeekAfterInsurance(): void {
    const dealerEval = scoreBlackjackHand(this.dealerCards);
    if (dealerEval.isBlackjack) {
      // Pay 2:1 insurance (plus return insurance stake = 3x insuranceBet)
      for (const s of this.seats) {
        if (s.insuranceBet > 0) {
          s.tableChips += s.insuranceBet * 3;
        }
      }
      this.settleRound();
      return;
    }
    this.beginPlayerTurns();
  }

  private beginPlayerTurns(): void {
    this.phase = 'player_turns';
    for (const s of this.seats) {
      if (!s.betPlaced) continue;
      s.activeHandIndex = 0;
      const h = s.hands[0];
      if (!h.isStood && !h.isBust && !h.isBlackjack) {
        this.currentTurnUserId = s.userId;
        this.currentTurnHandIndex = 0;
        this.turnExpiresAt = Date.now() + 25_000;
        this.bump();
        return;
      }
    }
    this.runDealerTurnAndSettle();
  }

  private advancePlayerTurn(): void {
    const currentSeatIdx = this.seats.findIndex((s) => s.userId === this.currentTurnUserId);
    if (currentSeatIdx !== -1) {
      const seat = this.seats[currentSeatIdx];
      // Check remaining split hands on same seat
      for (let hIdx = seat.activeHandIndex + 1; hIdx < seat.hands.length; hIdx++) {
        const h = seat.hands[hIdx];
        if (!h.isStood && !h.isBust) {
          seat.activeHandIndex = hIdx;
          this.currentTurnHandIndex = hIdx;
          this.turnExpiresAt = Date.now() + 25_000;
          return;
        }
      }
    }

    // Move to next seated bettor
    for (let i = currentSeatIdx + 1; i < this.seats.length; i++) {
      const nextSeat = this.seats[i];
      if (!nextSeat.betPlaced) continue;
      for (let hIdx = 0; hIdx < nextSeat.hands.length; hIdx++) {
        const h = nextSeat.hands[hIdx];
        if (!h.isStood && !h.isBust && !h.isBlackjack) {
          nextSeat.activeHandIndex = hIdx;
          this.currentTurnUserId = nextSeat.userId;
          this.currentTurnHandIndex = hIdx;
          this.turnExpiresAt = Date.now() + 25_000;
          return;
        }
      }
    }

    this.runDealerTurnAndSettle();
  }

  private runDealerTurnAndSettle(): void {
    this.phase = 'dealer_turn';
    this.currentTurnUserId = null;
    this.turnExpiresAt = null;

    const anyLiveHand = this.seats.some((s) => s.betPlaced && s.hands.some((h) => !h.isBust && !h.isBlackjack));
    if (anyLiveHand) {
      // Dealer stands on all 17s (including soft 17)
      let dealerEval = scoreBlackjackHand(this.dealerCards);
      while (dealerEval.score < 17) {
        this.dealerCards.push(this.drawCard());
        dealerEval = scoreBlackjackHand(this.dealerCards);
      }
    }

    this.settleRound();
  }

  private settleRound(): void {
    this.phase = 'settled';
    this.currentTurnUserId = null;
    this.turnExpiresAt = null;
    const dealerEval = scoreBlackjackHand(this.dealerCards);
    const dealerBJ = dealerEval.isBlackjack;

    const seatResults: Array<{
      userId: string;
      totalWagered: number;
      totalPayout: number;
      netChips: number;
      hadBlackjack: boolean;
      handsWon: number;
      handsPlayed: number;
    }> = [];

    for (const seat of this.seats) {
      if (!seat.betPlaced) continue;
      let totalWagered = seat.insuranceBet;
      let totalPayout = dealerBJ && seat.insuranceBet > 0 ? seat.insuranceBet * 3 : 0;
      let hadBlackjack = false;
      let handsWon = 0;

      for (const hand of seat.hands) {
        totalWagered += hand.bet;
        const playerBJ = hand.isBlackjack && seat.hands.length === 1;

        if (hand.isBust) {
          hand.outcome = 'bust';
          hand.payout = 0;
        } else if (playerBJ && !dealerBJ) {
          hand.outcome = 'blackjack';
          // 3:2 payout -> bet + 1.5 * bet
          hand.payout = Math.floor(hand.bet * 2.5);
          hadBlackjack = true;
          handsWon += 1;
        } else if (dealerBJ && !playerBJ) {
          hand.outcome = 'lose';
          hand.payout = 0;
        } else if (playerBJ && dealerBJ) {
          hand.outcome = 'push';
          hand.payout = hand.bet;
        } else if (dealerEval.isBust || hand.score > dealerEval.score) {
          hand.outcome = 'win';
          hand.payout = hand.bet * 2;
          handsWon += 1;
        } else if (hand.score === dealerEval.score) {
          hand.outcome = 'push';
          hand.payout = hand.bet;
        } else {
          hand.outcome = 'lose';
          hand.payout = 0;
        }

        seat.tableChips += hand.payout;
        totalPayout += hand.payout;
      }

      seatResults.push({
        userId: seat.userId,
        totalWagered,
        totalPayout,
        netChips: totalPayout - totalWagered,
        hadBlackjack,
        handsWon,
        handsPlayed: seat.hands.length,
      });
    }

    if (this.onRoundSettled) {
      this.onRoundSettled({
        roundNumber: this.roundNumber,
        dealerCards: [...this.dealerCards],
        dealerScore: dealerEval.score,
        seatResults,
      });
    }
    this.bump();
  }

  private drawCard(): Card {
    if (this.shoe.length === 0) {
      this.shoe = createMultiDeckShoe(6);
    }
    return this.shoe.pop()!;
  }

  private recalcHand(hand: BlackjackHandState): void {
    const res = scoreBlackjackHand(hand.cards);
    hand.score = res.score;
    hand.isSoft = res.isSoft;
    hand.isBust = res.isBust;
    hand.isBlackjack = res.isBlackjack;
  }

  private bump(): void {
    this.stateVersion += 1;
    this.eventSeq += 1;
  }

  public toTableView(): BlackjackTableView {
    const hideHoleCard =
      (this.phase === 'insurance' || this.phase === 'player_turns') && this.dealerCards.length >= 2;
    const visibleDealerCards = hideHoleCard ? [this.dealerCards[0]] : [...this.dealerCards];
    const dealerEval = visibleDealerCards.length > 0 ? scoreBlackjackHand(visibleDealerCards) : null;

    const seats: BlackjackSeatView[] = this.seats.map((s) => ({
      seatIndex: s.seatIndex,
      userId: s.userId,
      username: s.username,
      avatarId: s.avatarId,
      tableChips: s.tableChips,
      hands: s.hands.map((h) => ({ ...h, cards: [...h.cards] })),
      activeHandIndex: s.activeHandIndex,
      insuranceBet: s.insuranceBet,
      insuranceDecided: s.insuranceDecided,
      betPlaced: s.betPlaced,
      disconnected: s.disconnected,
      isCurrentTurn: this.currentTurnUserId === s.userId,
    }));

    return {
      roomId: this.roomId,
      roundNumber: this.roundNumber,
      phase: this.phase,
      dealerCards: visibleDealerCards,
      dealerHiddenCardCount: hideHoleCard ? 1 : 0,
      dealerScore: dealerEval ? dealerEval.score : null,
      dealerShowsAce: this.dealerCards.length > 0 && this.dealerCards[0].rank === 14,
      seats,
      currentTurnUserId: this.currentTurnUserId,
      currentTurnHandIndex: this.currentTurnHandIndex,
      turnExpiresAt: this.turnExpiresAt,
      nextRoundAt: this.nextRoundAt,
      gameSpeed: this.gameSpeed,
      minBet: this.minBet,
      maxBet: this.maxBet,
      rules: {
        blackjackPayout: '3:2',
        dealerStandsOnSoft17: true,
        doubleAfterSplit: true,
        splitAcesOneCard: true,
        maxSplitHands: 4,
        insurancePayout: '2:1',
      },
      stateVersion: this.stateVersion,
      eventSeq: this.eventSeq,
    };
  }
}
