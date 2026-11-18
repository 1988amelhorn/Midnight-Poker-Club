import { evaluateBestHand } from './pokerEvaluator.ts';
import type {
  BotDifficulty,
  Card,
  PokerActionType,
  PokerLegalActions,
  PokerStreet,
} from './types.ts';

/**
 * Strictly non-cheating bot input contract.
 * Only includes the bot's own two hole cards and public table state — never opponents' hidden cards or undealt deck.
 */
export interface BotDecisionInput {
  holeCards: Card[];
  communityCards: Card[];
  street: PokerStreet;
  pot: number;
  currentBet: number;
  smallBlind: number;
  bigBlind: number;
  legalActions: PokerLegalActions;
  selfSeat: {
    userId: string;
    seatIndex: number;
    chips: number;
    currentBet: number;
    totalBetThisHand: number;
    isDealer: boolean;
    isSmallBlind: boolean;
    isBigBlind: boolean;
  };
  seats: Array<{
    userId: string;
    seatIndex: number;
    chips: number;
    currentBet: number;
    folded: boolean;
    allIn: boolean;
    sittingOut: boolean;
    isDealer: boolean;
    isSmallBlind: boolean;
    isBigBlind: boolean;
  }>;
  actionLog: Array<{
    userId: string;
    text: string;
    street: string;
  }>;
  difficulty?: BotDifficulty;
  rng?: () => number;
}

export interface BotDecision {
  action: PokerActionType;
  amount?: number;
}

/**
 * Computes a Chen-inspired preflop score in [0..100].
 */
export function evaluatePreflopStrength(holeCards: Card[]): number {
  if (holeCards.length < 2) return 25;
  const [c1, c2] = holeCards[0].rank >= holeCards[1].rank
    ? [holeCards[0], holeCards[1]]
    : [holeCards[1], holeCards[0]];

  const r1 = c1.rank;
  const r2 = c2.rank;
  const isPair = r1 === r2;
  const suited = c1.suit === c2.suit;
  const gap = r1 - r2;

  // Base high-card points
  const highPtsMap: Record<number, number> = {
    14: 10,
    13: 8,
    12: 7,
    11: 6,
    10: 5,
  };
  let score = highPtsMap[r1] ?? r1 / 2;

  if (isPair) {
    score = Math.max(5, score * 2);
    if (r1 >= 10) score += 2.5;
    else if (r1 >= 7) score += 1.2;
  } else {
    if (suited) score += 2.1;
    if (gap === 1) score += 1.0;
    else if (gap === 2) score -= 0.5;
    else if (gap === 3) score -= 2.0;
    else if (gap === 4) score -= 3.8;
    else if (gap >= 5) score -= 5.0;

    if (gap <= 2 && r1 < 12 && r2 < 12) {
      score += 0.8; // Connectedness straight bonus
    }
    if (r1 >= 12 && r2 >= 10) {
      score += 1.5; // Broadway synergy
    }
  }

  // Normalize roughly [0..22.5] -> [0..100]
  return Math.max(8, Math.min(100, Math.round((score / 21.5) * 100)));
}

function detectPostflopDraws(holeCards: Card[], communityCards: Card[]): {
  hasFlushDraw: boolean;
  hasNutFlushDraw: boolean;
  hasOpenEndedStraightDraw: boolean;
  hasGutshot: boolean;
  overcards: number;
} {
  const all = [...holeCards, ...communityCards];
  if (holeCards.length < 2 || communityCards.length < 3 || communityCards.length >= 5) {
    return {
      hasFlushDraw: false,
      hasNutFlushDraw: false,
      hasOpenEndedStraightDraw: false,
      hasGutshot: false,
      overcards: 0,
    };
  }

  // Flush draw requiring at least one hole card of that suit
  const suitCounts = new Map<string, number>();
  for (const c of all) suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  let hasFlushDraw = false;
  let hasNutFlushDraw = false;
  for (const [suit, count] of suitCounts.entries()) {
    if (count === 4 && holeCards.some((h) => h.suit === suit)) {
      hasFlushDraw = true;
      if (holeCards.some((h) => h.suit === suit && h.rank === 14)) {
        hasNutFlushDraw = true;
      }
    }
  }

  // Straight draw detection
  const uniqueRanks = Array.from(new Set(all.map((c) => c.rank)));
  if (uniqueRanks.includes(14)) uniqueRanks.push(1 as unknown as Card['rank']);
  const rankSet = new Set(uniqueRanks);

  let hasOpenEndedStraightDraw = false;
  let hasGutshot = false;
  const boardRankSet = new Set(communityCards.map((c) => c.rank));
  let holeUsed = false;

  for (let low = 1; low <= 10; low++) {
    let hits = 0;
    let missingIdx = -1;
    let usesHole = false;
    for (let offset = 0; offset < 5; offset++) {
      const r = low + offset;
      const checkRank = r === 1 ? 14 : r;
      if (rankSet.has(r as Card['rank'])) {
        hits++;
        if (holeCards.some((h) => h.rank === checkRank) && !boardRankSet.has(checkRank as Card['rank'])) {
          usesHole = true;
        }
      } else {
        missingIdx = offset;
      }
    }
    if (hits === 4 && usesHole) {
      holeUsed = true;
      if (missingIdx === 0 || missingIdx === 4) {
        // Need consecutive 4 inside window and window not blocked on low/high ace edge
        if (low > 1 && low < 10) hasOpenEndedStraightDraw = true;
        else hasGutshot = true;
      } else {
        hasGutshot = true;
      }
    }
  }
  if (!holeUsed) {
    hasOpenEndedStraightDraw = false;
    hasGutshot = false;
  }

  const maxBoardRank = Math.max(...communityCards.map((c) => c.rank));
  const overcards = holeCards.filter((h) => h.rank > maxBoardRank).length;

  return {
    hasFlushDraw,
    hasNutFlushDraw,
    hasOpenEndedStraightDraw,
    hasGutshot,
    overcards,
  };
}

function getPositionScore(input: BotDecisionInput): number {
  const activeSeats = input.seats
    .filter((s) => !s.sittingOut && (s.chips > 0 || s.userId === input.selfSeat.userId))
    .sort((a, b) => a.seatIndex - b.seatIndex);
  if (activeSeats.length <= 2) {
    return input.selfSeat.isDealer ? 1 : 0; // Heads-up dealer is BTN/SB (acts in position postflop)
  }

  const dealerIdx = activeSeats.findIndex((s) => s.isDealer);
  const selfIdx = activeSeats.findIndex((s) => s.userId === input.selfSeat.userId);
  if (dealerIdx === -1 || selfIdx === -1) return 0.5;

  // Distance clockwise from dealer (1 = SB, 2 = BB, ..., 0 = BTN)
  const distFromDealer = (selfIdx - dealerIdx + activeSeats.length) % activeSeats.length;
  if (distFromDealer === 0) return 1.0; // Button
  if (distFromDealer === activeSeats.length - 1) return 0.85; // Cutoff
  if (distFromDealer <= 2) return 0.25; // Blinds (out of position postflop)
  const rel = distFromDealer / activeSeats.length;
  return Math.max(0.15, Math.min(0.8, rel));
}

function clampBet(amount: number, legal: PokerLegalActions, step: number): number {
  const stepped = Math.round(amount / Math.max(1, step)) * Math.max(1, step);
  return Math.max(legal.minBetOrRaiseTo, Math.min(legal.maxBetOrRaiseTo, stepped));
}

export function choosePokerBotAction(input: BotDecisionInput): BotDecision {
  const { legalActions, selfSeat, holeCards, communityCards, street, pot, currentBet, bigBlind } = input;
  const difficulty: BotDifficulty = input.difficulty ?? 'normal';
  const rng = input.rng ?? Math.random;
  const roll = rng();

  const toCall = legalActions.canCall ? legalActions.callAmount : 0;
  const totalPotAfterCall = Math.max(1, pot + toCall);
  const potOdds = toCall > 0 ? toCall / totalPotAfterCall : 0;
  const stackBB = selfSeat.chips / Math.max(1, bigBlind);
  const spr = selfSeat.chips / Math.max(bigBlind, pot);
  const position = getPositionScore(input); // 0..1 (1 = BTN)
  const activeOpponents = input.seats.filter((s) => s.userId !== selfSeat.userId && !s.folded && !s.sittingOut).length;

  // Analyze betting history in current hand/street
  const streetRaises = input.actionLog.filter(
    (l) => l.street === street && (l.text.startsWith('Raised') || l.text.startsWith('Bet') || l.text.startsWith('Went all-in'))
  ).length;
  const preflopAggressorLog = [...input.actionLog]
    .reverse()
    .find((l) => l.street === 'preflop' && (l.text.startsWith('Raised') || l.text.startsWith('Went all-in')));
  const isPreflopAggressor = preflopAggressorLog?.userId === selfSeat.userId;

  // Compute raw hand strength [0..100]
  let strength = 35;

  if (street === 'preflop') {
    strength = evaluatePreflopStrength(holeCards);

    // Position bonus / penalty
    if (position >= 0.8) strength += 8;
    else if (position <= 0.35 && toCall > bigBlind) strength -= 6;

    // BB defends slightly wider against a single modest open
    if (selfSeat.isBigBlind && toCall > 0 && toCall <= bigBlind * 2.5) {
      strength += 9;
    }

    // Multiway tightness vs heavy 3-bet / 4-bet action
    if (streetRaises >= 2) {
      strength -= 14;
    } else if (toCall > bigBlind * 4) {
      strength -= 9;
    }
  } else {
    // Postflop: use 5-7 card evaluator + draws + board texture
    const ev = evaluateBestHand([...holeCards, ...communityCards]);
    const draws = detectPostflopDraws(holeCards, communityCards);
    const boardHighest = communityCards.length > 0 ? Math.max(...communityCards.map((c) => c.rank)) : 14;
    const holeHighest = holeCards.length > 0 ? Math.max(...holeCards.map((c) => c.rank)) : 2;
    const hasPocketPair = holeCards.length === 2 && holeCards[0].rank === holeCards[1].rank;

    // Evaluate if board itself already contains pair/trips so we don't overvalue board-played hands
    const boardEval = communityCards.length >= 5 ? evaluateBestHand(communityCards) : null;
    const playsOnlyBoard = boardEval !== null && ev.score === boardEval.score;

    if (playsOnlyBoard) {
      strength = 18 + (holeHighest >= 13 ? 8 : 0);
    } else if (ev.categoryRank >= 6) {
      // Full House, Quads, Straight Flush, Royal Flush
      strength = 96;
    } else if (ev.categoryRank === 5) {
      // Flush
      strength = holeCards.some((h) => h.rank === 14) ? 92 : 84;
    } else if (ev.categoryRank === 4) {
      // Straight
      strength = 82;
    } else if (ev.categoryRank === 3) {
      // Three of a Kind / Set
      strength = hasPocketPair ? 85 : 77;
    } else if (ev.categoryRank === 2) {
      // Two Pair
      strength = 71;
    } else if (ev.categoryRank === 1) {
      // One Pair — distinguish overpair / top pair vs weak underpair
      const pairRank = ev.tiebreakers[0];
      if (hasPocketPair && pairRank > boardHighest) {
        strength = 69; // Overpair
      } else if (pairRank >= boardHighest && holeCards.some((h) => h.rank === pairRank)) {
        const kicker = ev.tiebreakers[1] ?? 7;
        strength = kicker >= 12 ? 64 : 56; // Top pair
      } else if (holeCards.some((h) => h.rank === pairRank)) {
        strength = 44; // Middle / bottom pair
      } else {
        // Paired board with just high card in hand
        strength = 26;
      }
    } else {
      // High card
      strength = holeHighest === 14 ? 26 : 16;
    }

    // Add draw equity postflop (stronger on flop with 2 cards to come than turn)
    const flopMult = street === 'flop' ? 1.25 : 0.8;
    if (draws.hasNutFlushDraw) strength += Math.round(18 * flopMult);
    else if (draws.hasFlushDraw) strength += Math.round(15 * flopMult);
    if (draws.hasOpenEndedStraightDraw) strength += Math.round(14 * flopMult);
    else if (draws.hasGutshot) strength += Math.round(7 * flopMult);
    if (draws.overcards === 2 && ev.categoryRank === 0) strength += Math.round(7 * flopMult);

    // Multiway caution with single pair or less
    if (activeOpponents >= 3 && ev.categoryRank <= 1) {
      strength -= 7;
    }
    // Facing heavy raise/check-raise postflop
    if (streetRaises >= 2 && ev.categoryRank <= 1 && !draws.hasFlushDraw) {
      strength -= 12;
    }
  }

  // Difficulty tuning (all strictly fair & non-cheating)
  const bluffBonus = difficulty === 'hard' ? 0.08 : difficulty === 'easy' ? 0.02 : 0.05;
  if (difficulty === 'easy') {
    // Easy bots play slightly looser / more passive
    strength += Math.round((rng() - 0.5) * 14);
  } else if (difficulty === 'hard') {
    strength += position >= 0.8 ? 4 : 0;
  }

  // Clamp normalized strength to [0..100]
  const effectiveStrength = Math.max(0, Math.min(100, strength));
  const estEquity = effectiveStrength / 100;

  // --- DECISION LOGIC ---

  // 1. Short-stack preflop / committed SPR push-fold awareness
  if (stackBB <= 10 && legalActions.canAllIn) {
    if (effectiveStrength >= 58 || (toCall > 0 && potOdds <= 0.34 && effectiveStrength >= 48)) {
      return { action: 'all_in' };
    }
  }

  // 2. Facing a bet (toCall > 0)
  if (toCall > 0) {
    const raiseSizeFactor = difficulty === 'hard' ? 2.75 : 2.5;
    const betCommitFraction = toCall / Math.max(1, selfSeat.chips);

    // Value raise / 3-bet with monsters or very strong hands
    if ((legalActions.canRaise || legalActions.canAllIn) && effectiveStrength >= 78) {
      const raiseFrequency = effectiveStrength >= 88 ? 0.85 : 0.62;
      if (roll < raiseFrequency) {
        if (legalActions.canRaise) {
          const desired = street === 'preflop'
            ? currentBet * raiseSizeFactor
            : currentBet + Math.round(pot * 0.65);
          const target = clampBet(desired, legalActions, bigBlind);
          if (target >= legalActions.maxBetOrRaiseTo * 0.8 && legalActions.canAllIn) {
            return { action: 'all_in' };
          }
          return { action: 'raise', amount: target };
        }
        return { action: 'all_in' };
      }
    }

    // Occasional semi-bluff raise with strong draws or high position fold-equity
    if (legalActions.canRaise && street !== 'river' && spr > 1.8 && effectiveStrength >= 45 && effectiveStrength < 68 && roll < 0.14 + bluffBonus) {
      const target = clampBet(currentBet + Math.round(pot * 0.6), legalActions, bigBlind);
      if (target < selfSeat.chips * 0.65) {
        return { action: 'raise', amount: target };
      }
    }

    // Evaluate Call vs Fold using pot odds + effective strength + implied/position cushion
    const requiredEquity = potOdds;
    const impliedCushion = position >= 0.75 ? 0.08 : 0.04;
    const riskPenalty = betCommitFraction > 0.55 && effectiveStrength < 70 ? 0.12 : 0;

    if (estEquity + impliedCushion - riskPenalty >= requiredEquity && effectiveStrength >= 34) {
      return { action: 'call' };
    }

    // Pot-committed call when already put >50% stack in or tiny call (<0.5 BB)
    if (toCall <= Math.max(1, bigBlind * 0.5) && effectiveStrength >= 26) {
      return { action: 'call' };
    }

    if (legalActions.canFold) {
      return { action: 'fold' };
    }
    return { action: 'call' };
  }

  // 3. Checked to / Free to check or open bet (toCall === 0)
  // Preflop open / limp-check option (e.g. BB unraised)
  if (street === 'preflop') {
    if ((legalActions.canRaise || legalActions.canBet) && effectiveStrength >= 58) {
      const target = clampBet(bigBlind * 2.5, legalActions, bigBlind);
      return { action: legalActions.canBet ? 'bet' : 'raise', amount: target };
    }
    if (legalActions.canCheck) {
      return { action: 'check' };
    }
  }

  // Postflop open bet when checked to
  if (legalActions.canBet) {
    // Strong made hand value bet
    if (effectiveStrength >= 62) {
      const betFrac = effectiveStrength >= 82 ? 0.68 : 0.52;
      const desired = Math.max(legalActions.minBetOrRaiseTo, Math.round(pot * betFrac));
      const target = clampBet(desired, legalActions, bigBlind);
      if (target >= legalActions.maxBetOrRaiseTo * 0.85 && legalActions.canAllIn) {
        return { action: 'all_in' };
      }
      return { action: 'bet', amount: target };
    }

    // Continuation bet if preflop aggressor on flop vs <= 2 opponents
    if (street === 'flop' && isPreflopAggressor && activeOpponents <= 2 && roll < 0.55) {
      const target = clampBet(Math.max(legalActions.minBetOrRaiseTo, Math.round(pot * 0.45)), legalActions, bigBlind);
      return { action: 'bet', amount: target };
    }

    // Medium strength bet or occasional late-position bluff
    const shouldBluff = position >= 0.75 && activeOpponents <= 2 && roll < 0.1 + bluffBonus;
    if ((effectiveStrength >= 48 && roll < 0.42) || shouldBluff) {
      const target = clampBet(Math.max(legalActions.minBetOrRaiseTo, Math.round(pot * 0.48)), legalActions, bigBlind);
      return { action: 'bet', amount: target };
    }
  }

  // Fallback check
  if (legalActions.canCheck) {
    return { action: 'check' };
  }
  if (legalActions.canCall) {
    return { action: 'call' };
  }
  return { action: 'fold' };
}
