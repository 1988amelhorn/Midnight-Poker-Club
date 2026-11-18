import type { BlackjackHandState } from './types.ts';

export interface BlackjackHandStatusSummary {
  handText: string;
  statusText: string;
  tone: 'gold' | 'rose' | 'cyan' | 'emerald' | 'slate';
  dealerText: string | null;
}

export interface LastBlackjackRoundSummary {
  headline: string;
  subtitle: string;
  tone: 'gold' | 'emerald' | 'sky' | 'rose';
}

export function getBlackjackHandStatusSummary(params: {
  hands: BlackjackHandState[] | null | undefined;
  activeHandIndex: number;
  dealerScore: number | null | undefined;
  dealerHiddenCardCount: number;
}): BlackjackHandStatusSummary {
  const { hands, activeHandIndex, dealerScore, dealerHiddenCardCount } = params;

  const dealerText =
    dealerScore !== null && dealerScore !== undefined
      ? dealerHiddenCardCount > 0
        ? `Dealer: ${dealerScore} + ?`
        : `Dealer: ${dealerScore}`
      : null;

  if (!hands || hands.length === 0 || hands[0].cards.length === 0) {
    return {
      handText: 'Ready',
      statusText: 'Place a bet to deal',
      tone: 'slate',
      dealerText,
    };
  }

  const active = hands[activeHandIndex] ?? hands[0];
  const prefix = hands.length > 1 ? `Hand ${active.handIndex + 1}/${hands.length}: ` : '';

  if (active.isBlackjack) {
    return {
      handText: `${prefix}21`,
      statusText: 'Blackjack!',
      tone: 'gold',
      dealerText,
    };
  }

  if (active.isBust) {
    return {
      handText: `${prefix}${active.score}`,
      statusText: 'Bust',
      tone: 'rose',
      dealerText,
    };
  }

  if (active.isSoft) {
    return {
      handText: `${prefix}${active.score}`,
      statusText: `Soft ${active.score}`,
      tone: 'cyan',
      dealerText,
    };
  }

  return {
    handText: `${prefix}${active.score}`,
    statusText: `Hard ${active.score}`,
    tone: 'emerald',
    dealerText,
  };
}

export function formatLastBlackjackHandResult(params: {
  hands: BlackjackHandState[] | null | undefined;
  dealerScore: number | null | undefined;
}): LastBlackjackRoundSummary | null {
  const { hands, dealerScore } = params;
  if (!hands || hands.length === 0) return null;
  const settledHands = hands.filter((h) => Boolean(h.outcome));
  if (settledHands.length === 0) return null;

  const dScore = dealerScore ?? 0;

  if (settledHands.length === 1) {
    const h = settledHands[0];
    const net = h.payout - h.bet;

    if (h.outcome === 'blackjack') {
      return {
        headline: `You won +${net.toLocaleString()} chips`,
        subtitle: 'Blackjack!',
        tone: 'gold',
      };
    }
    if (h.outcome === 'win') {
      return {
        headline: `You won +${net.toLocaleString()} chips`,
        subtitle: `${h.score} vs Dealer ${dScore}`,
        tone: 'emerald',
      };
    }
    if (h.outcome === 'push') {
      return {
        headline: 'Push',
        subtitle: `Tied at ${h.score}`,
        tone: 'sky',
      };
    }
    if (h.outcome === 'bust') {
      return {
        headline: 'Dealer won',
        subtitle: `You busted (${h.score})`,
        tone: 'rose',
      };
    }
    return {
      headline: `Dealer won with ${dScore}`,
      subtitle: `Your hand: ${h.score}`,
      tone: 'rose',
    };
  }

  const totalBet = settledHands.reduce((acc, h) => acc + h.bet, 0);
  const totalPayout = settledHands.reduce((acc, h) => acc + h.payout, 0);
  const net = totalPayout - totalBet;
  const hasBj = settledHands.some((h) => h.outcome === 'blackjack');

  if (net > 0) {
    return {
      headline: `You won +${net.toLocaleString()} chips`,
      subtitle: hasBj ? 'Blackjack on split hand' : `vs Dealer ${dScore}`,
      tone: hasBj ? 'gold' : 'emerald',
    };
  }
  if (net === 0) {
    return {
      headline: 'Push',
      subtitle: 'Split hands broke even',
      tone: 'sky',
    };
  }
  return {
    headline: dScore > 21 ? 'Split round lost' : `Dealer won with ${dScore}`,
    subtitle: `${settledHands.length} split hands (${net.toLocaleString()})`,
    tone: 'rose',
  };
}
