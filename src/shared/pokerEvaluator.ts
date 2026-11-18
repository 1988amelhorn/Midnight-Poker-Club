import type {
  Card,
  HandCategoryName,
  HandEvaluation,
  HandStrengthOdds,
  PokerWinnerDisplay,
  Rank,
  Suit,
} from './types.ts';

const RANK_NAMES: Record<number, string> = {
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  7: 'Seven',
  8: 'Eight',
  9: 'Nine',
  10: 'Ten',
  11: 'Jack',
  12: 'Queen',
  13: 'King',
  14: 'Ace',
};

const RANK_PLURALS: Record<number, string> = {
  2: 'Twos',
  3: 'Threes',
  4: 'Fours',
  5: 'Fives',
  6: 'Sixes',
  7: 'Sevens',
  8: 'Eights',
  9: 'Nines',
  10: 'Tens',
  11: 'Jacks',
  12: 'Queens',
  13: 'Kings',
  14: 'Aces',
};

const ALL_SUITS: Suit[] = ['s', 'h', 'd', 'c'];
const ALL_RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

function encodeScore(categoryRank: number, tiebreakers: number[]): number {
  let score = categoryRank * Math.pow(15, 5);
  for (let i = 0; i < 5; i++) {
    const val = tiebreakers[i] ?? 0;
    score += val * Math.pow(15, 4 - i);
  }
  return score;
}

export function evaluateFiveCards(cards: Card[]): HandEvaluation {
  if (cards.length !== 5) {
    throw new Error(`evaluateFiveCards requires exactly 5 cards, received ${cards.length}`);
  }

  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const ranks = sorted.map((c) => c.rank);
  const isFlush = sorted.every((c) => c.suit === sorted[0].suit);

  // Check straight (including A-2-3-4-5 wheel)
  const uniqueRanks = Array.from(new Set(ranks));
  let straightHigh = 0;
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0] - uniqueRanks[4] === 4) {
      straightHigh = uniqueRanks[0];
    } else if (
      uniqueRanks[0] === 14 &&
      uniqueRanks[1] === 5 &&
      uniqueRanks[2] === 4 &&
      uniqueRanks[3] === 3 &&
      uniqueRanks[4] === 2
    ) {
      straightHigh = 5;
    }
  }

  // Count rank frequencies
  const counts = new Map<number, number>();
  for (const r of ranks) {
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const groups = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  if (isFlush && straightHigh > 0) {
    if (straightHigh === 14) {
      return {
        categoryRank: 9,
        category: 'Royal Flush',
        tiebreakers: [14],
        score: encodeScore(9, [14]),
        description: 'Royal Flush',
        bestFiveCards: sorted,
      };
    }
    return {
      categoryRank: 8,
      category: 'Straight Flush',
      tiebreakers: [straightHigh],
      score: encodeScore(8, [straightHigh]),
      description: `Straight Flush — ${RANK_NAMES[straightHigh]} High`,
      bestFiveCards: sorted,
    };
  }

  if (groups[0][1] === 4) {
    const quad = groups[0][0];
    const kicker = groups[1][0];
    return {
      categoryRank: 7,
      category: 'Four of a Kind',
      tiebreakers: [quad, kicker],
      score: encodeScore(7, [quad, kicker]),
      description: `Four of a Kind — ${RANK_PLURALS[quad]}`,
      bestFiveCards: sorted,
    };
  }

  if (groups[0][1] === 3 && groups[1][1] === 2) {
    const trips = groups[0][0];
    const pair = groups[1][0];
    return {
      categoryRank: 6,
      category: 'Full House',
      tiebreakers: [trips, pair],
      score: encodeScore(6, [trips, pair]),
      description: `Full House — ${RANK_PLURALS[trips]} Full of ${RANK_PLURALS[pair]}`,
      bestFiveCards: sorted,
    };
  }

  if (isFlush) {
    return {
      categoryRank: 5,
      category: 'Flush',
      tiebreakers: ranks,
      score: encodeScore(5, ranks),
      description: `Flush — ${RANK_NAMES[ranks[0]]} High`,
      bestFiveCards: sorted,
    };
  }

  if (straightHigh > 0) {
    return {
      categoryRank: 4,
      category: 'Straight',
      tiebreakers: [straightHigh],
      score: encodeScore(4, [straightHigh]),
      description: `Straight — ${RANK_NAMES[straightHigh]} High`,
      bestFiveCards: sorted,
    };
  }

  if (groups[0][1] === 3) {
    const trips = groups[0][0];
    const kickers = groups.slice(1).map((g) => g[0]);
    return {
      categoryRank: 3,
      category: 'Three of a Kind',
      tiebreakers: [trips, ...kickers],
      score: encodeScore(3, [trips, ...kickers]),
      description: `Three of a Kind — ${RANK_PLURALS[trips]}`,
      bestFiveCards: sorted,
    };
  }

  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = groups[0][0];
    const lowPair = groups[1][0];
    const kicker = groups[2][0];
    return {
      categoryRank: 2,
      category: 'Two Pair',
      tiebreakers: [highPair, lowPair, kicker],
      score: encodeScore(2, [highPair, lowPair, kicker]),
      description: `Two Pair — ${RANK_PLURALS[highPair]} & ${RANK_PLURALS[lowPair]}`,
      bestFiveCards: sorted,
    };
  }

  if (groups[0][1] === 2) {
    const pair = groups[0][0];
    const kickers = groups.slice(1).map((g) => g[0]);
    return {
      categoryRank: 1,
      category: 'One Pair',
      tiebreakers: [pair, ...kickers],
      score: encodeScore(1, [pair, ...kickers]),
      description: `Pair of ${RANK_PLURALS[pair]}`,
      bestFiveCards: sorted,
    };
  }

  return {
    categoryRank: 0,
    category: 'High Card',
    tiebreakers: ranks,
    score: encodeScore(0, ranks),
    description: `${RANK_NAMES[ranks[0]]} High`,
    bestFiveCards: sorted,
  };
}

export function evaluateBestHand(cards: Card[]): HandEvaluation {
  if (cards.length < 5) {
    throw new Error(`Need at least 5 cards to evaluate best hand, got ${cards.length}`);
  }
  if (cards.length === 5) {
    return evaluateFiveCards(cards);
  }

  let best: HandEvaluation | null = null;
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            const evalResult = evaluateFiveCards([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || evalResult.score > best.score) {
              best = evalResult;
            }
          }
        }
      }
    }
  }
  return best!;
}

export function compareHandEvaluations(a: HandEvaluation, b: HandEvaluation): number {
  return a.score - b.score;
}

function createRemainingDeck(usedCards: Card[]): Card[] {
  const usedKeys = new Set(usedCards.map((c) => `${c.rank}${c.suit}`));
  const deck: Card[] = [];
  for (const suit of ALL_SUITS) {
    for (const rank of ALL_RANKS) {
      if (!usedKeys.has(`${rank}${suit}`)) {
        deck.push({ rank, suit });
      }
    }
  }
  return deck;
}

function sampleCards(deck: Card[], count: number): Card[] {
  // Partial Fisher-Yates copy
  const copy = deck.slice();
  const result: Card[] = [];
  for (let i = 0; i < count; i++) {
    const idx = i + Math.floor(Math.random() * (copy.length - i));
    const tmp = copy[i];
    copy[i] = copy[idx];
    copy[idx] = tmp;
    result.push(copy[i]);
  }
  return result;
}

const ORDERED_CATEGORIES: HandCategoryName[] = [
  'Royal Flush',
  'Straight Flush',
  'Four of a Kind',
  'Full House',
  'Flush',
  'Straight',
  'Three of a Kind',
  'Two Pair',
  'One Pair',
  'High Card',
];

export function calculateHandStrengthAndOdds(
  holeCards: Card[],
  communityCards: Card[],
  activeOpponents: number,
  simulations = 320
): HandStrengthOdds {
  if (holeCards.length !== 2) {
    return {
      currentCategory: 'High Card',
      currentDescription: 'Waiting for hole cards',
      winProbability: 0,
      strengthLabel: 'Speculative',
      summaryHint: 'Estimated odds appear once hole cards are dealt.',
      categoryOdds: ORDERED_CATEGORIES.map((category) => ({ category, probability: 0 })),
      simulations: 0,
    };
  }

  const opponents = Math.max(1, Math.min(8, activeOpponents));
  const known = [...holeCards, ...communityCards];
  const remaining = createRemainingDeck(known);
  const cardsNeededForBoard = Math.max(0, 5 - communityCards.length);
  const cardsPerTrial = cardsNeededForBoard + opponents * 2;

  // Determine current hand description
  let currentCategory: HandCategoryName = 'High Card';
  let currentDescription = '';

  if (known.length >= 5) {
    const currentEval = evaluateBestHand(known);
    currentCategory = currentEval.category;
    currentDescription = currentEval.description;
  } else {
    const [c1, c2] = [...holeCards].sort((a, b) => b.rank - a.rank);
    if (c1.rank === c2.rank) {
      currentCategory = 'One Pair';
      currentDescription = `Pocket ${RANK_PLURALS[c1.rank]}`;
    } else {
      currentCategory = 'High Card';
      currentDescription = `${RANK_NAMES[c1.rank]}-${RANK_NAMES[c2.rank]}${c1.suit === c2.suit ? ' Suited' : ''}`;
    }
  }

  const catCounts = new Map<HandCategoryName, number>();
  for (const cat of ORDERED_CATEGORIES) catCounts.set(cat, 0);

  let winEquity = 0;
  for (let s = 0; s < simulations; s++) {
    const drawn = sampleCards(remaining, cardsPerTrial);
    const board = [...communityCards, ...drawn.slice(0, cardsNeededForBoard)];
    const heroEval = evaluateBestHand([...holeCards, ...board]);
    catCounts.set(heroEval.category, (catCounts.get(heroEval.category) ?? 0) + 1);

    let heroBeatAll = true;
    let tieCount = 1;
    let offset = cardsNeededForBoard;
    for (let o = 0; o < opponents; o++) {
      const oppHole = [drawn[offset], drawn[offset + 1]];
      offset += 2;
      const oppEval = evaluateBestHand([...oppHole, ...board]);
      if (oppEval.score > heroEval.score) {
        heroBeatAll = false;
        break;
      }
      if (oppEval.score === heroEval.score) {
        tieCount += 1;
      }
    }
    if (heroBeatAll) {
      winEquity += 1 / tieCount;
    }
  }

  const winProbability = Math.round((winEquity / simulations) * 1000) / 10;

  let strengthLabel: HandStrengthOdds['strengthLabel'] = 'Speculative';
  let summaryHint = 'Low equity vs active field; proceed cautiously';
  if (winProbability >= 72) {
    strengthLabel = 'Monster Hand';
    summaryHint = 'Very high estimated chance of winning';
  } else if (winProbability >= 52) {
    strengthLabel = 'Strong Hand';
    summaryHint = 'High estimated chance of winning';
  } else if (winProbability >= 35) {
    strengthLabel = 'Playable Hand';
    summaryHint = 'Competitive equity with room to improve';
  } else if (winProbability >= 20) {
    strengthLabel = 'Marginal Hand';
    summaryHint = 'Pot odds & position dependent';
  }

  const categoryOdds = ORDERED_CATEGORIES.map((category) => ({
    category,
    probability: Math.round(((catCounts.get(category) ?? 0) / simulations) * 1000) / 10,
  }));

  return {
    currentCategory,
    currentDescription,
    winProbability,
    strengthLabel,
    summaryHint,
    categoryOdds,
    simulations,
  };
}

export interface LiveHoldemHandSummary {
  handName: string;
  detail: string;
  strengthTier: 'Weak' | 'Medium' | 'Strong' | null;
  winProbability: number | null;
}

export interface LastHoldemHandSummary {
  headline: string;
  subtitle: string;
}

export function classifyLiveHoldemHand(params: {
  holeCards: Card[] | null | undefined;
  visibleBoard: Card[];
  serverHandStrength: HandStrengthOdds | null | undefined;
  totalServerBoardCount: number;
  allowProbabilityAssist: boolean;
  folded?: boolean;
}): LiveHoldemHandSummary {
  const {
    holeCards,
    visibleBoard,
    serverHandStrength,
    totalServerBoardCount,
    allowProbabilityAssist,
    folded = false,
  } = params;

  if (folded) {
    return {
      handName: 'Folded',
      detail: 'Out for this hand',
      strengthTier: null,
      winProbability: null,
    };
  }

  if (!holeCards || holeCards.length < 2) {
    return {
      handName: 'Waiting',
      detail: 'Ready for next deal',
      strengthTier: null,
      winProbability: null,
    };
  }

  const combined = [...holeCards, ...visibleBoard];
  let handName: string = 'High Card';
  let detail = '';
  let categoryRank = 0;

  if (combined.length >= 5) {
    const ev = evaluateBestHand(combined);
    handName = ev.category;
    detail = ev.description;
    categoryRank = ev.categoryRank;
  } else {
    const [c1, c2] = [...holeCards].sort((a, b) => b.rank - a.rank);
    const suited = c1.suit === c2.suit;
    if (c1.rank === c2.rank) {
      handName = 'One Pair';
      detail = `Pocket ${RANK_PLURALS[c1.rank]}`;
      categoryRank = 1;
    } else {
      handName = 'High Card';
      detail = `${RANK_NAMES[c1.rank]}-${RANK_NAMES[c2.rank]}${suited ? ' Suited' : ''}`;
      categoryRank = 0;
    }
  }

  const boardSynced = visibleBoard.length === totalServerBoardCount;
  const exposedWinProb =
    allowProbabilityAssist && boardSynced && serverHandStrength && serverHandStrength.simulations > 0
      ? serverHandStrength.winProbability
      : null;

  let strengthTier: 'Weak' | 'Medium' | 'Strong' = 'Weak';
  if (exposedWinProb !== null) {
    if (exposedWinProb >= 52) strengthTier = 'Strong';
    else if (exposedWinProb >= 32) strengthTier = 'Medium';
    else strengthTier = 'Weak';
  } else if (combined.length >= 5) {
    if (categoryRank >= 2) {
      strengthTier = 'Strong';
    } else if (categoryRank === 1) {
      const ev = evaluateBestHand(combined);
      const pairRank = ev.tiebreakers[0] ?? 0;
      strengthTier = pairRank >= 11 ? 'Medium' : pairRank >= 7 ? 'Medium' : 'Weak';
    } else {
      const high = Math.max(holeCards[0].rank, holeCards[1].rank);
      strengthTier = high === 14 ? 'Medium' : 'Weak';
    }
  } else {
    // Preflop heuristic
    const [hi, lo] = [...holeCards].sort((a, b) => b.rank - a.rank);
    const suited = hi.suit === lo.suit;
    const connected = hi.rank - lo.rank <= 2;
    if (
      (hi.rank === lo.rank && hi.rank >= 9) ||
      (hi.rank === 14 && lo.rank >= 12) ||
      (hi.rank === 14 && lo.rank >= 11 && suited) ||
      (hi.rank === 13 && lo.rank === 12 && suited)
    ) {
      strengthTier = 'Strong';
    } else if (
      hi.rank === lo.rank ||
      (hi.rank >= 11 && lo.rank >= 10) ||
      (hi.rank === 14 && suited) ||
      (suited && connected && lo.rank >= 6)
    ) {
      strengthTier = 'Medium';
    } else {
      strengthTier = 'Weak';
    }
  }

  return {
    handName,
    detail,
    strengthTier,
    winProbability: exposedWinProb,
  };
}

export function formatLastHoldemHandResult(
  winners: PokerWinnerDisplay[] | null | undefined
): LastHoldemHandSummary | null {
  if (!winners || winners.length === 0) return null;

  const byUser = new Map<string, { username: string; total: number; handCategory: string }>();
  for (const w of winners) {
    const prev = byUser.get(w.userId);
    if (prev) {
      prev.total += w.amount;
    } else {
      byUser.set(w.userId, {
        username: w.username,
        total: w.amount,
        handCategory: w.handCategory,
      });
    }
  }

  const aggregated = Array.from(byUser.values());
  const totalPot = aggregated.reduce((acc, item) => acc + item.total, 0);
  const firstCat = aggregated[0]?.handCategory || '';

  const headline =
    aggregated.length === 1
      ? `${aggregated[0].username} won ${aggregated[0].total.toLocaleString()} chips`
      : `${aggregated.map((a) => a.username).join(' & ')} split ${totalPot.toLocaleString()} chips`;

  const subtitle =
    firstCat === 'Uncontested'
      ? 'Opponents folded'
      : firstCat
        ? `with ${firstCat}`
        : 'Showdown won';

  return { headline, subtitle };
}
