export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  rank: Rank;
  suit: Suit;
}

export function getCardBlackjackValue(card: Card): number {
  if (card.rank === 14) return 11;
  if (card.rank >= 10) return 10;
  return card.rank;
}

export type GameSpeed = 'relaxed' | 'normal' | 'fast';

export interface SpeedTimings {
  dealCardMs: number;
  revealFlopMs: number;
  revealTurnMs: number;
  revealRiverMs: number;
  showWinnerMs: number;
  nextHandDelayMs: number;
}

export const GAME_SPEED_CONFIG: Record<GameSpeed, SpeedTimings> = {
  relaxed: {
    dealCardMs: 1500,
    revealFlopMs: 2000,
    revealTurnMs: 2000,
    revealRiverMs: 2000,
    showWinnerMs: 4000,
    nextHandDelayMs: 5000,
  },
  normal: {
    dealCardMs: 800,
    revealFlopMs: 1500,
    revealTurnMs: 1500,
    revealRiverMs: 1500,
    showWinnerMs: 3000,
    nextHandDelayMs: 4000,
  },
  fast: {
    dealCardMs: 300,
    revealFlopMs: 700,
    revealTurnMs: 700,
    revealRiverMs: 700,
    showWinnerMs: 2000,
    nextHandDelayMs: 2000,
  },
};

export type UserRole = 'player' | 'moderator' | 'admin';

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  avatarId: string;
  bio: string;
  role: UserRole;
  level: number;
  xp: number;
  isSuspended: boolean;
  emailVerified: boolean;
  soundEnabled: boolean;
  musicEnabled: boolean;
  sfxVolume: number;
  musicVolume: number;
  reducedAnimations: boolean;
  preferredSpeed: GameSpeed;
  createdAt: string;
  lastSeenAt: string;
}

export interface PlayerWallet {
  userId: string;
  chipBalance: number;
  welcomeBonusClaimed: boolean;
  lastDailyBonusAt: string | null;
  nextDailyBonusAt: string | null;
  dailyStreak: number;
  lifetimeWon: number;
  lifetimeLost: number;
}

export type TransactionType =
  | 'welcome_bonus'
  | 'daily_bonus'
  | 'table_buyin'
  | 'table_cashout'
  | 'poker_win'
  | 'poker_loss'
  | 'blackjack_bet'
  | 'blackjack_payout'
  | 'tournament_buyin'
  | 'tournament_payout'
  | 'friend_gift_sent'
  | 'friend_gift_received'
  | 'admin_adjustment';

export interface ChipTransaction {
  id: string;
  userId: string;
  amount: number;
  balanceAfter: number;
  txType: TransactionType;
  referenceId?: string;
  description: string;
  createdAt: string;
}

export interface PlayerStatistics {
  userId: string;
  pokerHandsPlayed: number;
  pokerHandsWon: number;
  tournamentsPlayed: number;
  tournamentsWon: number;
  blackjackHandsPlayed: number;
  blackjackHandsWon: number;
  blackjackBlackjacks: number;
  totalGamesPlayed: number;
}

export interface AchievementBadge {
  badgeKey: string;
  title: string;
  description: string;
  unlockedAt: string;
}

export type HandCategoryName =
  | 'Royal Flush'
  | 'Straight Flush'
  | 'Four of a Kind'
  | 'Full House'
  | 'Flush'
  | 'Straight'
  | 'Three of a Kind'
  | 'Two Pair'
  | 'One Pair'
  | 'High Card';

export interface HandEvaluation {
  categoryRank: number; // 0..9
  category: HandCategoryName;
  tiebreakers: number[];
  score: number;
  description: string;
  bestFiveCards: Card[];
}

export interface HandStrengthOdds {
  currentCategory: HandCategoryName | 'High Card';
  currentDescription: string;
  winProbability: number; // 0-100
  strengthLabel: 'Monster Hand' | 'Strong Hand' | 'Playable Hand' | 'Marginal Hand' | 'Speculative';
  summaryHint: string;
  categoryOdds: Array<{
    category: HandCategoryName;
    probability: number;
  }>;
  simulations: number;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export type PokerStreet = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type PokerActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';

export interface PokerSeatPublic {
  seatIndex: number;
  userId: string;
  username: string;
  avatarId: string;
  chips: number;
  currentBet: number;
  totalBetThisHand: number;
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
  disconnected: boolean;
  isBot?: boolean;
  botDifficulty?: BotDifficulty;
  lastAction?: string;
  holeCards: Card[] | null; // null unless viewer's own cards or revealed at showdown
  cardCount: number;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isCurrentTurn: boolean;
  isWinner: boolean;
  wonAmount?: number;
  winningHandName?: string;
  winningCards?: Card[];
}

export interface PokerSidePot {
  amount: number;
  eligibleUserIds: string[];
}

export interface PokerWinnerDisplay {
  userId: string;
  username: string;
  amount: number;
  handCategory: string;
  handDescription: string;
  bestFiveCards: Card[];
  potIndex: number;
}

export interface PokerLegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canBet: boolean;
  canRaise: boolean;
  minBetOrRaiseTo: number;
  maxBetOrRaiseTo: number;
  canAllIn: boolean;
}

export interface PokerTableView {
  roomId: string;
  handNumber: number;
  street: PokerStreet;
  communityCards: Card[];
  pot: number;
  sidePots: PokerSidePot[];
  smallBlind: number;
  bigBlind: number;
  ante: number;
  dealerSeat: number;
  currentTurnUserId: string | null;
  turnExpiresAt: number | null;
  minRaiseTo: number;
  currentBet: number;
  gameSpeed: GameSpeed;
  allowProbabilityAssist: boolean;
  seats: PokerSeatPublic[];
  winners: PokerWinnerDisplay[];
  actionLog: Array<{ id: string; userId: string; username: string; text: string; street: string; seq: number }>;
  legalActions: PokerLegalActions | null;
  handStrength: HandStrengthOdds | null;
  stateVersion: number;
  eventSeq: number;
  nextHandAt: number | null;
}

// BLACKJACK TYPES
export type BlackjackPhase = 'waiting' | 'betting' | 'insurance' | 'player_turns' | 'dealer_turn' | 'settled';
export type BlackjackActionType = 'place_bet' | 'hit' | 'stand' | 'double' | 'split' | 'insurance_accept' | 'insurance_decline';

export interface BlackjackHandState {
  handIndex: number;
  cards: Card[];
  bet: number;
  score: number;
  isSoft: boolean;
  isBust: boolean;
  isBlackjack: boolean;
  isStood: boolean;
  isDoubled: boolean;
  isSplitAce: boolean;
  outcome?: 'blackjack' | 'win' | 'push' | 'lose' | 'bust';
  payout: number;
}

export interface BlackjackSeatView {
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
  isCurrentTurn: boolean;
}

export interface BlackjackTableView {
  roomId: string;
  roundNumber: number;
  phase: BlackjackPhase;
  dealerCards: Card[]; // hidden card represented by null? Actually array with only visible cards or hiddenCount
  dealerHiddenCardCount: number;
  dealerScore: number | null;
  dealerShowsAce: boolean;
  seats: BlackjackSeatView[];
  currentTurnUserId: string | null;
  currentTurnHandIndex: number;
  turnExpiresAt: number | null;
  nextRoundAt: number | null;
  gameSpeed: GameSpeed;
  minBet: number;
  maxBet: number;
  rules: {
    blackjackPayout: string;
    dealerStandsOnSoft17: boolean;
    doubleAfterSplit: boolean;
    splitAcesOneCard: boolean;
    maxSplitHands: number;
    insurancePayout: string;
  };
  stateVersion: number;
  eventSeq: number;
}

export type GameType = 'holdem' | 'blackjack';
export type RoomVisibility = 'public' | 'private';

export interface GameRoomSummary {
  id: string;
  code: string;
  name: string;
  gameType: GameType;
  visibility: RoomVisibility;
  hasPassword: boolean;
  hostId: string;
  hostUsername: string;
  maxPlayers: number;
  playerCount: number;
  smallBlind: number;
  bigBlind: number;
  minBuyin: number;
  maxBuyin: number;
  gameSpeed: GameSpeed;
  allowProbabilityAssist: boolean;
  status: 'waiting' | 'active' | 'closed';
  tournamentId?: string | null;
  players: Array<{
    userId: string;
    username: string;
    avatarId: string;
    seatIndex: number;
    chips: number;
    isHost: boolean;
    isBot?: boolean;
    botDifficulty?: BotDifficulty;
    status: string;
  }>;
  createdAt: string;
}

export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
}

export interface TournamentSummary {
  id: string;
  code: string;
  name: string;
  creatorId: string;
  creatorUsername: string;
  visibility: RoomVisibility;
  maxPlayers: number;
  registeredCount: number;
  startingChips: number;
  startingSb: number;
  startingBb: number;
  blindIntervalMinutes: number;
  blindSchedule: BlindLevel[];
  anteEnabled: boolean;
  entryFee: number;
  allowProbabilityAssist: boolean;
  gameSpeed: GameSpeed;
  startCondition: 'auto_when_full' | 'host_or_full';
  status: 'registering' | 'in_progress' | 'completed' | 'cancelled';
  currentLevel: number;
  levelEndsAt: string | null;
  roomId: string | null;
  winnerId: string | null;
  winnerUsername: string | null;
  totalHandsPlayed: number;
  players: Array<{
    userId: string;
    username: string;
    avatarId: string;
    tournamentChips: number;
    status: 'registered' | 'active' | 'eliminated' | 'winner';
    placement: number | null;
    eliminations: number;
    isBot?: boolean;
    botDifficulty?: BotDifficulty;
  }>;
  createdAt: string;
}

export interface FriendItem {
  userId: string;
  username: string;
  avatarId: string;
  level: number;
  online: boolean;
  currentRoomId?: string | null;
  currentRoomName?: string | null;
  canJoin?: boolean;
  canWatch?: boolean;
  roomPlayerCount?: number;
  roomMaxPlayers?: number;
}

export interface FriendRequestItem {
  id: string;
  senderId: string;
  senderUsername: string;
  senderAvatarId: string;
  receiverId: string;
  receiverUsername: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface ChatMessageItem {
  id: string;
  channelType: 'room' | 'tournament' | 'direct' | 'global';
  channelId: string;
  senderId: string;
  senderUsername: string;
  senderAvatarId: string;
  recipientId?: string;
  message: string;
  isEmote: boolean;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  notifType: string;
  title: string;
  body: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export interface GameHistoryItem {
  id: string;
  gameType: 'holdem' | 'blackjack' | 'tournament';
  roomName: string;
  netChips: number;
  summary: string;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatarId: string;
  level: number;
  value: number;
  secondaryLabel: string;
}

export interface ModerationReportItem {
  id: string;
  reporterId: string;
  reporterUsername: string;
  reportedUserId: string;
  reportedUsername: string;
  roomId?: string | null;
  reason: string;
  details: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  resolutionNotes?: string | null;
  createdAt: string;
}
