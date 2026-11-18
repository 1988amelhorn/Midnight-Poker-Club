import { randomInt, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { BlackjackTableEngine } from '../src/shared/blackjackEngine.ts';
import { choosePokerBotAction } from '../src/shared/pokerBotAi.ts';
import { PokerTableEngine } from '../src/shared/pokerEngine.ts';
import {
  GAME_SPEED_CONFIG,
  type BlackjackActionType,
  type BlindLevel,
  type BotDifficulty,
  type GameRoomSummary,
  type GameSpeed,
  type GameType,
  type PokerActionType,
  type RoomVisibility,
  type TournamentSummary,
} from '../src/shared/types.ts';
import type { ServerDataStore } from './dataStore.ts';

const BOT_ROSTER: Array<{ username: string; avatarId: string }> = [
  { username: 'Vega', avatarId: 'violet-diamond' },
  { username: 'Maverick', avatarId: 'king-gold' },
  { username: 'Luna', avatarId: 'cyber-heart' },
  { username: 'Cipher', avatarId: 'ace-spade' },
  { username: 'Nova', avatarId: 'sunset-high' },
  { username: 'Sloane', avatarId: 'emerald-club' },
  { username: 'Dante', avatarId: 'obsidian-pro' },
  { username: 'Kira', avatarId: 'royal-flush' },
  { username: 'Sterling', avatarId: 'ace-spade' },
  { username: 'Aria', avatarId: 'cyber-heart' },
  { username: 'Zane', avatarId: 'king-gold' },
  { username: 'Cleo', avatarId: 'violet-diamond' },
];

export interface GameManagerOptions {
  botThinkDelayRangeMs?: [number, number];
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateSixCharCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_CHARS[randomInt(0, CODE_CHARS.length)];
    }
    if (!existing.has(code)) return code;
  }
  return randomUUID().slice(0, 6).toUpperCase();
}

export function buildDefaultBlindSchedule(startingSb: number, startingBb: number, intervalMinutes: number, anteEnabled: boolean): BlindLevel[] {
  const multipliers = [1, 2, 4, 6, 10, 15, 25, 40];
  return multipliers.map((m, idx) => ({
    level: idx + 1,
    smallBlind: startingSb * m,
    bigBlind: startingBb * m,
    ante: anteEnabled ? Math.floor((startingBb * m) / 5) : 0,
    durationMinutes: intervalMinutes,
  }));
}

interface ManagedRoom {
  id: string;
  code: string;
  name: string;
  gameType: GameType;
  visibility: RoomVisibility;
  passwordHash: string | null;
  hostId: string;
  hostUsername: string;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  minBuyin: number;
  maxBuyin: number;
  gameSpeed: GameSpeed;
  allowProbabilityAssist: boolean;
  status: 'waiting' | 'active' | 'closed';
  tournamentId: string | null;
  createdAt: string;
  pokerEngine?: PokerTableEngine;
  blackjackEngine?: BlackjackTableEngine;
  nextRoundTimer?: NodeJS.Timeout;
  turnTimer?: NodeJS.Timeout;
  botTimer?: NodeJS.Timeout;
}

interface ManagedTournament {
  id: string;
  code: string;
  name: string;
  creatorId: string;
  creatorUsername: string;
  visibility: RoomVisibility;
  maxPlayers: number;
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
  players: Map<
    string,
    {
      userId: string;
      username: string;
      avatarId: string;
      tournamentChips: number;
      status: 'registered' | 'active' | 'eliminated' | 'winner';
      placement: number | null;
      eliminations: number;
      isBot?: boolean;
      botDifficulty?: BotDifficulty;
    }
  >;
  blindTimer?: NodeJS.Timeout;
  createdAt: string;
}

interface WsClientMeta {
  ws: WebSocket;
  userId: string;
  roomId: string | null;
  tournamentId: string | null;
}

export class GameManager {
  public rooms = new Map<string, ManagedRoom>();
  public roomCodeToId = new Map<string, string>();
  public tournaments = new Map<string, ManagedTournament>();
  public tournamentCodeToId = new Map<string, string>();
  public clients = new Set<WsClientMeta>();
  private botThinkDelayRangeMs: [number, number];

  constructor(private dataStore: ServerDataStore, options?: GameManagerOptions) {
    const [minMs, maxMs] = options?.botThinkDelayRangeMs ?? [2000, 5000];
    this.botThinkDelayRangeMs = [Math.max(10, minMs), Math.max(Math.max(10, minMs), maxMs)];
    this.seedPublicEmptyTables();
  }

  public cleanup(): void {
    for (const room of this.rooms.values()) {
      if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
      if (room.turnTimer) clearTimeout(room.turnTimer);
      if (room.botTimer) clearTimeout(room.botTimer);
    }
    for (const tourn of this.tournaments.values()) {
      if (tourn.blindTimer) clearInterval(tourn.blindTimer);
    }
  }

  private seedPublicEmptyTables(): void {
    const publicTemplates: Array<{
      code: string;
      name: string;
      gameType: GameType;
      maxPlayers: number;
      smallBlind: number;
      bigBlind: number;
      minBuyin: number;
      maxBuyin: number;
    }> = [
      {
        code: 'MIDN50',
        name: 'Midnight Skyline Hold\'em (25/50)',
        gameType: 'holdem',
        maxPlayers: 9,
        smallBlind: 25,
        bigBlind: 50,
        minBuyin: 500,
        maxBuyin: 5000,
      },
      {
        code: 'CYBR20',
        name: 'Midnight Micro Hold\'em (10/20)',
        gameType: 'holdem',
        maxPlayers: 6,
        smallBlind: 10,
        bigBlind: 20,
        minBuyin: 200,
        maxBuyin: 2000,
      },
      {
        code: 'VIP21X',
        name: 'Emerald VIP Blackjack',
        gameType: 'blackjack',
        maxPlayers: 7,
        smallBlind: 25,
        bigBlind: 1000,
        minBuyin: 250,
        maxBuyin: 10000,
      },
    ];

    for (const tpl of publicTemplates) {
      const id = randomUUID();
      const room: ManagedRoom = {
        id,
        code: tpl.code,
        name: tpl.name,
        gameType: tpl.gameType,
        visibility: 'public',
        passwordHash: null,
        hostId: 'system',
        hostUsername: 'Midnight House',
        maxPlayers: tpl.maxPlayers,
        smallBlind: tpl.smallBlind,
        bigBlind: tpl.bigBlind,
        minBuyin: tpl.minBuyin,
        maxBuyin: tpl.maxBuyin,
        gameSpeed: 'normal',
        allowProbabilityAssist: true,
        status: 'waiting',
        tournamentId: null,
        createdAt: new Date().toISOString(),
      };
      this.attachEngine(room);
      this.rooms.set(id, room);
      this.roomCodeToId.set(tpl.code, id);
    }
  }

  private attachEngine(room: ManagedRoom): void {
    if (room.gameType === 'holdem') {
      const engine = new PokerTableEngine({
        roomId: room.id,
        smallBlind: room.smallBlind,
        bigBlind: room.bigBlind,
        gameSpeed: room.gameSpeed,
        allowProbabilityAssist: room.allowProbabilityAssist,
        isTournament: Boolean(room.tournamentId),
      });
      engine.onHandCompleted = (summary) => {
        this.handlePokerHandCompleted(room, summary);
      };
      room.pokerEngine = engine;
    } else {
      const engine = new BlackjackTableEngine({
        roomId: room.id,
        minBet: Math.max(10, room.smallBlind),
        maxBet: Math.max(500, room.bigBlind),
        gameSpeed: room.gameSpeed,
      });
      engine.onRoundSettled = (summary) => {
        this.handleBlackjackRoundSettled(room, summary);
      };
      room.blackjackEngine = engine;
    }
  }

  public createRoom(params: {
    hostId: string;
    name: string;
    gameType: GameType;
    visibility: RoomVisibility;
    maxPlayers: number;
    password?: string;
    smallBlind?: number;
    bigBlind?: number;
    minBuyin?: number;
    maxBuyin?: number;
    gameSpeed?: GameSpeed;
    allowProbabilityAssist?: boolean;
    tournamentId?: string | null;
  }): { ok: boolean; room?: GameRoomSummary; error?: string } {
    const host = this.dataStore.users.get(params.hostId);
    if (!host) return { ok: false, error: 'Host account not found' };

    const cleanName = params.name.trim();
    if (cleanName.length < 2 || cleanName.length > 48) {
      return { ok: false, error: 'Room name must be 2–48 characters' };
    }

    const maxPlayers =
      params.gameType === 'blackjack'
        ? Math.max(1, Math.min(7, params.maxPlayers))
        : Math.max(2, Math.min(9, params.maxPlayers));

    const sb = Math.max(5, params.smallBlind ?? 25);
    const bb = Math.max(sb * 2, params.bigBlind ?? sb * 2);
    const minBuyin = Math.max(bb * 4, params.minBuyin ?? 500);
    const maxBuyin = Math.max(minBuyin, params.maxBuyin ?? 5000);

    const existingCodes = new Set(this.roomCodeToId.keys());
    const code = generateSixCharCode(existingCodes);
    const id = randomUUID();

    const room: ManagedRoom = {
      id,
      code,
      name: cleanName,
      gameType: params.gameType,
      visibility: params.visibility,
      passwordHash: params.password ? this.dataStore.hashPassword(params.password) : null,
      hostId: params.hostId,
      hostUsername: host.profile.username,
      maxPlayers,
      smallBlind: sb,
      bigBlind: bb,
      minBuyin,
      maxBuyin,
      gameSpeed: params.gameSpeed ?? 'normal',
      allowProbabilityAssist: params.allowProbabilityAssist ?? true,
      status: 'waiting',
      tournamentId: params.tournamentId ?? null,
      createdAt: new Date().toISOString(),
    };
    this.attachEngine(room);
    this.rooms.set(id, room);
    this.roomCodeToId.set(code, id);
    return { ok: true, room: this.summarizeRoom(room) };
  }

  public joinRoom(params: {
    userId: string;
    roomIdOrCode: string;
    password?: string;
    buyinAmount?: number;
  }): { ok: boolean; room?: GameRoomSummary; error?: string } {
    const cleanRef = params.roomIdOrCode.trim();
    const roomId = this.roomCodeToId.get(cleanRef.toUpperCase()) ?? cleanRef;
    const room = this.rooms.get(roomId);
    if (!room || room.status === 'closed') {
      return { ok: false, error: 'Room not found or has closed' };
    }

    const user = this.dataStore.users.get(params.userId);
    if (!user) return { ok: false, error: 'Player account not found' };
    if (user.profile.isSuspended) return { ok: false, error: 'Account is suspended' };

    const isTournamentRoom = Boolean(room.tournamentId);
    if (isTournamentRoom) {
      const tourn = this.tournaments.get(room.tournamentId!);
      if (!tourn || !tourn.players.has(params.userId)) {
        return { ok: false, error: 'You are not registered in this tournament' };
      }
    }

    // Reconnect if already seated!
    if (room.gameType === 'holdem' && room.pokerEngine) {
      const already = room.pokerEngine.seats.find((s) => s.userId === params.userId);
      if (already) {
        already.disconnected = false;
        this.broadcastRoomState(room.id);
        return { ok: true, room: this.summarizeRoom(room) };
      }
    }
    if (room.gameType === 'blackjack' && room.blackjackEngine) {
      const already = room.blackjackEngine.seats.find((s) => s.userId === params.userId);
      if (already) {
        already.disconnected = false;
        this.broadcastRoomState(room.id);
        return { ok: true, room: this.summarizeRoom(room) };
      }
    }

    // Validate password for password-protected private rooms
    if (room.passwordHash) {
      if (!params.password || !this.dataStore.verifyPassword(params.password, room.passwordHash)) {
        return { ok: false, error: 'Incorrect room password' };
      }
    }

    const currentPlayers = this.getRoomPlayerCount(room);
    if (currentPlayers >= room.maxPlayers) {
      return { ok: false, error: 'Room is full' };
    }

    // First human joining a system-hosted room becomes temporary room host for controls
    if (room.hostId === 'system') {
      room.hostId = params.userId;
      room.hostUsername = user.profile.username;
    }

    let tableStack = 0;
    if (!isTournamentRoom) {
      const requested = Math.floor(params.buyinAmount ?? Math.min(room.maxBuyin, Math.max(room.minBuyin, 1000)));
      const clamped = Math.max(room.minBuyin, Math.min(room.maxBuyin, requested));
      const debit = this.dataStore.mutateChips({
        userId: params.userId,
        delta: -clamped,
        txType: 'table_buyin',
        referenceId: room.id,
        description: `Joined ${room.name} table stack`,
      });
      if (!debit.ok) {
        return { ok: false, error: debit.error || 'Insufficient virtual chips for table buy-in' };
      }
      tableStack = clamped;
    } else {
      const tourn = this.tournaments.get(room.tournamentId!)!;
      tableStack = tourn.players.get(params.userId)!.tournamentChips;
    }

    if (room.gameType === 'holdem' && room.pokerEngine) {
      room.pokerEngine.addPlayer(params.userId, user.profile.username, user.profile.avatarId, tableStack);
    } else if (room.gameType === 'blackjack' && room.blackjackEngine) {
      room.blackjackEngine.addPlayer(params.userId, user.profile.username, user.profile.avatarId, tableStack);
    }

    this.dataStore.onlineUsers.set(params.userId, { roomId: room.id, roomName: room.name, lastPing: Date.now() });
    this.broadcastRoomState(room.id);
    this.broadcastLobbyUpdate();
    return { ok: true, room: this.summarizeRoom(room) };
  }

  public leaveRoom(userId: string, roomId: string): { ok: boolean; returnedChips: number } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, returnedChips: 0 };

    let remaining = 0;
    if (room.gameType === 'holdem' && room.pokerEngine) {
      remaining = room.pokerEngine.removePlayer(userId);
    } else if (room.gameType === 'blackjack' && room.blackjackEngine) {
      remaining = room.blackjackEngine.removePlayer(userId);
    }

    if (!room.tournamentId && remaining > 0) {
      this.dataStore.mutateChips({
        userId,
        delta: remaining,
        txType: 'table_cashout',
        referenceId: room.id,
        description: `Left ${room.name} and cashed out table stack`,
      });
    }

    const humanCount =
      room.gameType === 'holdem' && room.pokerEngine
        ? room.pokerEngine.seats.filter((s) => !s.isBot).length
        : room.blackjackEngine
          ? room.blackjackEngine.seats.length
          : 0;

    if (humanCount === 0 && room.hostId !== 'system' && !room.tournamentId) {
      // Revert to waiting and clear bots/timers when all humans have left
      if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
      if (room.turnTimer) clearTimeout(room.turnTimer);
      if (room.botTimer) clearTimeout(room.botTimer);
      if (room.pokerEngine) {
        room.pokerEngine.seats = [];
        room.pokerEngine.street = 'waiting';
        room.pokerEngine.currentTurnUserId = null;
        room.pokerEngine.turnExpiresAt = null;
        room.pokerEngine.nextHandAt = null;
      }
      room.status = 'waiting';
    }

    this.dataStore.onlineUsers.set(userId, { roomId: null, roomName: null, lastPing: Date.now() });
    this.broadcastRoomState(room.id);
    this.broadcastLobbyUpdate();
    return { ok: true, returnedChips: room.tournamentId ? 0 : remaining };
  }

  private pickBotPersona(usedNames: Set<string>): { username: string; avatarId: string } {
    const unused = BOT_ROSTER.filter((b) => !usedNames.has(b.username));
    if (unused.length > 0) {
      return unused[randomInt(0, unused.length)];
    }
    const base = BOT_ROSTER[randomInt(0, BOT_ROSTER.length)];
    return { username: `${base.username}${randomInt(10, 99)}`, avatarId: base.avatarId };
  }

  public addBotToRoom(
    actorId: string,
    roomId: string,
    difficulty: BotDifficulty = 'normal'
  ): { ok: boolean; room?: GameRoomSummary; botUserId?: string; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || room.status === 'closed') return { ok: false, error: 'Room not found' };
    if (room.gameType !== 'holdem' || !room.pokerEngine) {
      return { ok: false, error: 'Poker bots are only supported at Texas Hold\'em tables' };
    }
    if (room.tournamentId) {
      return { ok: false, error: 'Manage tournament bots from the tournament waiting lobby' };
    }
    if (room.hostId !== actorId && room.hostId !== 'system') {
      return { ok: false, error: 'Only the table host can add bots' };
    }
    if (room.pokerEngine.street !== 'waiting') {
      return { ok: false, error: 'Bots can only be added before the hand starts' };
    }
    if (room.pokerEngine.seats.length >= room.maxPlayers) {
      return { ok: false, error: 'Table is already full' };
    }

    const usedNames = new Set(room.pokerEngine.seats.map((s) => s.username));
    const persona = this.pickBotPersona(usedNames);
    const botUserId = `bot_${randomUUID().slice(0, 8)}`;
    const botChips = Math.min(room.maxBuyin, Math.max(room.minBuyin, room.bigBlind * 20));

    room.pokerEngine.addPlayer(botUserId, persona.username, persona.avatarId, botChips, undefined, {
      isBot: true,
      botDifficulty: difficulty || 'normal',
    });

    this.broadcastRoomState(room.id);
    this.broadcastLobbyUpdate();
    return { ok: true, room: this.summarizeRoom(room), botUserId };
  }

  public removeBotFromRoom(
    actorId: string,
    roomId: string,
    botUserId: string
  ): { ok: boolean; room?: GameRoomSummary; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || !room.pokerEngine) return { ok: false, error: 'Poker table not found' };
    if (room.tournamentId) {
      return { ok: false, error: 'Tournament bots cannot be removed after tournament start' };
    }
    if (room.hostId !== actorId && room.hostId !== 'system') {
      return { ok: false, error: 'Only the table host can remove bots' };
    }
    if (room.pokerEngine.street !== 'waiting' && room.pokerEngine.street !== 'showdown') {
      return { ok: false, error: 'Wait until the current hand finishes to remove a bot' };
    }
    const seat = room.pokerEngine.seats.find((s) => s.userId === botUserId);
    if (!seat || !seat.isBot) {
      return { ok: false, error: 'Bot seat not found' };
    }

    room.pokerEngine.removePlayer(botUserId);
    this.broadcastRoomState(room.id);
    this.broadcastLobbyUpdate();
    return { ok: true, room: this.summarizeRoom(room) };
  }

  public setRoomBotDifficulty(
    actorId: string,
    roomId: string,
    botUserId: string,
    difficulty: BotDifficulty
  ): { ok: boolean; room?: GameRoomSummary; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || !room.pokerEngine) return { ok: false, error: 'Poker table not found' };
    if (room.hostId !== actorId && room.hostId !== 'system') {
      return { ok: false, error: 'Only the table host can change bot difficulty' };
    }
    if (room.pokerEngine.street !== 'waiting' && room.pokerEngine.street !== 'showdown') {
      return { ok: false, error: 'Bot difficulty cannot be changed during an active hand' };
    }
    const seat = room.pokerEngine.seats.find((s) => s.userId === botUserId);
    if (!seat || !seat.isBot) {
      return { ok: false, error: 'Bot seat not found' };
    }

    seat.botDifficulty = difficulty;
    if (room.tournamentId) {
      const tourn = this.tournaments.get(room.tournamentId);
      const tp = tourn?.players.get(botUserId);
      if (tp) tp.botDifficulty = difficulty;
    }

    this.broadcastRoomState(room.id);
    return { ok: true, room: this.summarizeRoom(room) };
  }

  public startRoomGame(userId: string, roomId: string): { ok: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'Room not found' };
    if (room.hostId !== userId && room.hostId !== 'system') {
      return { ok: false, error: 'Only the table host can start the game' };
    }

    if (room.gameType === 'holdem' && room.pokerEngine) {
      if (!room.pokerEngine.canStartHand()) {
        return { ok: false, error: 'Need at least 2 active players with chips to start Texas Hold\'em' };
      }
      room.status = 'active';
      room.pokerEngine.startNewHand();
      this.schedulePokerTimers(room);
      this.broadcastRoomState(room.id);
      this.broadcastLobbyUpdate();
      return { ok: true };
    }

    if (room.gameType === 'blackjack' && room.blackjackEngine) {
      if (room.blackjackEngine.seats.length < 1) {
        return { ok: false, error: 'Need at least 1 seated player to start Blackjack' };
      }
      room.status = 'active';
      room.blackjackEngine.startNewBettingRound();
      this.broadcastRoomState(room.id);
      this.broadcastLobbyUpdate();
      return { ok: true };
    }

    return { ok: false, error: 'Unsupported game type' };
  }

  public setRoomSpeed(userId: string, roomId: string, speed: GameSpeed): { ok: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'Room not found' };
    if (room.hostId !== userId) {
      return { ok: false, error: 'Only the table host can change game speed' };
    }
    room.gameSpeed = speed;
    if (room.pokerEngine) room.pokerEngine.gameSpeed = speed;
    if (room.blackjackEngine) room.blackjackEngine.gameSpeed = speed;
    this.broadcastRoomState(room.id);
    return { ok: true };
  }

  public setProbabilityAssist(userId: string, roomId: string, enabled: boolean): { ok: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'Room not found' };
    if (room.hostId !== userId) {
      return { ok: false, error: 'Only the host can toggle probability assistance' };
    }
    room.allowProbabilityAssist = enabled;
    if (room.pokerEngine) room.pokerEngine.allowProbabilityAssist = enabled;
    this.broadcastRoomState(room.id);
    return { ok: true };
  }

  public handlePokerAction(
    userId: string,
    roomId: string,
    action: PokerActionType,
    amount?: number,
    actionId?: string
  ): { ok: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || !room.pokerEngine) return { ok: false, error: 'Poker table not found' };
    const res = room.pokerEngine.applyAction(userId, action, amount, actionId);
    if (!res.ok) return res;
    if (!res.duplicate) {
      this.schedulePokerTimers(room);
      this.broadcastRoomState(room.id);
    }
    return { ok: true };
  }

  public handlePokerSitOut(userId: string, roomId: string, sittingOut: boolean): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.pokerEngine) return;
    room.pokerEngine.setSitOut(userId, sittingOut);
    this.broadcastRoomState(room.id);
  }

  public handleBlackjackAction(
    userId: string,
    roomId: string,
    action: BlackjackActionType,
    amount?: number,
    actionId?: string
  ): { ok: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || !room.blackjackEngine) return { ok: false, error: 'Blackjack table not found' };
    if (room.status === 'waiting') room.status = 'active';
    const res = room.blackjackEngine.applyAction(userId, action, amount, actionId);
    if (!res.ok) return res;
    if (!res.duplicate) {
      this.scheduleBlackjackTimers(room);
      this.broadcastRoomState(room.id);
    }
    return { ok: true };
  }

  private schedulePokerTimers(room: ManagedRoom): void {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    if (room.botTimer) clearTimeout(room.botTimer);
    const engine = room.pokerEngine;
    if (!engine) return;

    if (engine.currentTurnUserId && engine.turnExpiresAt) {
      const expectedActor = engine.currentTurnUserId;
      const expectedVersion = engine.stateVersion;
      const actorSeat = engine.seats.find((s) => s.userId === expectedActor);

      // Schedule natural 2-5s decision timer for Bot players without peeking at opponents' hole cards
      if (actorSeat?.isBot) {
        const [minDelay, maxDelay] = this.botThinkDelayRangeMs;
        const botDelayMs = randomInt(minDelay, maxDelay + 1);
        room.botTimer = setTimeout(() => {
          if (
            room.status === 'closed' ||
            engine.currentTurnUserId !== expectedActor ||
            engine.stateVersion !== expectedVersion
          ) {
            return;
          }
          const legal = engine.getLegalActions(expectedActor);
          if (!legal) return;
          const decision = choosePokerBotAction({
            holeCards: [...actorSeat.holeCards],
            communityCards: [...engine.communityCards],
            street: engine.street,
            pot: engine.pot,
            currentBet: engine.currentBet,
            smallBlind: engine.smallBlind,
            bigBlind: engine.bigBlind,
            legalActions: legal,
            selfSeat: {
              userId: actorSeat.userId,
              seatIndex: actorSeat.seatIndex,
              chips: actorSeat.chips,
              currentBet: actorSeat.currentBet,
              totalBetThisHand: actorSeat.totalBetThisHand,
              isDealer: actorSeat.isDealer,
              isSmallBlind: actorSeat.isSmallBlind,
              isBigBlind: actorSeat.isBigBlind,
            },
            seats: engine.seats.map((s) => ({
              userId: s.userId,
              seatIndex: s.seatIndex,
              chips: s.chips,
              currentBet: s.currentBet,
              folded: s.folded,
              allIn: s.allIn,
              sittingOut: s.sittingOut,
              isDealer: s.isDealer,
              isSmallBlind: s.isSmallBlind,
              isBigBlind: s.isBigBlind,
            })),
            actionLog: engine.actionLog.map((l) => ({
              userId: l.userId,
              text: l.text,
              street: l.street,
            })),
            difficulty: actorSeat.botDifficulty ?? 'normal',
          });
          this.handlePokerAction(expectedActor, room.id, decision.action, decision.amount);
        }, botDelayMs);
        return;
      }

      const ms = Math.max(1000, engine.turnExpiresAt - Date.now());
      room.turnTimer = setTimeout(() => {
        if (engine.currentTurnUserId === expectedActor && engine.stateVersion === expectedVersion) {
          const legal = engine.getLegalActions(expectedActor);
          engine.applyAction(expectedActor, legal?.canCheck ? 'check' : 'fold');
          this.schedulePokerTimers(room);
          this.broadcastRoomState(room.id);
        }
      }, ms);
    }
  }

  private scheduleBlackjackTimers(room: ManagedRoom): void {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    const engine = room.blackjackEngine;
    if (!engine) return;
    if (engine.currentTurnUserId && engine.turnExpiresAt) {
      const ms = Math.max(1000, engine.turnExpiresAt - Date.now());
      const expectedActor = engine.currentTurnUserId;
      const expectedVersion = engine.stateVersion;
      room.turnTimer = setTimeout(() => {
        if (engine.currentTurnUserId === expectedActor && engine.stateVersion === expectedVersion) {
          engine.applyAction(expectedActor, 'stand');
          this.scheduleBlackjackTimers(room);
          this.broadcastRoomState(room.id);
        }
      }, ms);
    }
  }

  private handlePokerHandCompleted(
    room: ManagedRoom,
    summary: {
      handNumber: number;
      winners: Array<{ userId: string; username: string; amount: number; handDescription: string }>;
      pot: number;
      runoutCardsAdded?: number;
      seatNetChanges: Array<{ userId: string; netChips: number; wonPot: number; handCategory?: string; handDescription?: string; isWinner: boolean }>;
    }
  ): void {
    const engine = room.pokerEngine!;
    for (const s of summary.seatNetChanges) {
      const rec = this.dataStore.users.get(s.userId);
      if (!rec) continue;
      rec.stats.pokerHandsPlayed += 1;
      rec.stats.totalGamesPlayed += 1;
      if (s.isWinner) rec.stats.pokerHandsWon += 1;
      this.dataStore.addXpAndCheckAchievements(s.userId, s.isWinner ? 35 : 12);
      this.dataStore.recordGameHistory(s.userId, {
        gameType: room.tournamentId ? 'tournament' : 'holdem',
        roomName: room.name,
        netChips: s.netChips,
        summary: s.isWinner
          ? `Won ${s.wonPot.toLocaleString()} chips (${s.handDescription || 'Pot'})`
          : `Hand #${summary.handNumber} (${s.netChips >= 0 ? '+' : ''}${s.netChips} chips)`,
      });
    }

    // Tournament progression & elimination check
    if (room.tournamentId) {
      const tourn = this.tournaments.get(room.tournamentId);
      if (tourn) {
        tourn.totalHandsPlayed += 1;
        this.syncTournamentAfterHand(tourn, engine);
      }
    }

    // Respect Game Speed pacing (plus board runout reveals on all-ins) before dealing next hand!
    const timings = GAME_SPEED_CONFIG[room.gameSpeed];
    const runoutStreets =
      summary.runoutCardsAdded && summary.runoutCardsAdded >= 4
        ? 3
        : summary.runoutCardsAdded && summary.runoutCardsAdded >= 2
          ? 2
          : summary.runoutCardsAdded === 1
            ? 1
            : 0;
    const runoutExtraMs = runoutStreets * timings.revealTurnMs;
    const pauseMs = timings.showWinnerMs + timings.nextHandDelayMs + runoutExtraMs;
    engine.nextHandAt = Date.now() + pauseMs;

    if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
    room.nextRoundTimer = setTimeout(() => {
      if (room.tournamentId) {
        const tourn = this.tournaments.get(room.tournamentId);
        if (!tourn || tourn.status === 'completed') return;
        // Apply current blind level to engine
        const lvl = tourn.blindSchedule[tourn.currentLevel - 1];
        if (lvl) {
          engine.smallBlind = lvl.smallBlind;
          engine.bigBlind = lvl.bigBlind;
          engine.ante = lvl.ante;
        }
      }
      if (engine.canStartHand()) {
        engine.startNewHand();
        this.schedulePokerTimers(room);
      } else {
        engine.street = 'waiting';
        engine.nextHandAt = null;
        room.status = 'waiting';
      }
      this.broadcastRoomState(room.id);
    }, pauseMs);
  }

  private handleBlackjackRoundSettled(
    room: ManagedRoom,
    summary: {
      roundNumber: number;
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
    }
  ): void {
    const engine = room.blackjackEngine!;
    for (const r of summary.seatResults) {
      const rec = this.dataStore.users.get(r.userId);
      if (!rec) continue;
      rec.stats.blackjackHandsPlayed += r.handsPlayed;
      rec.stats.blackjackHandsWon += r.handsWon;
      if (r.hadBlackjack) rec.stats.blackjackBlackjacks += 1;
      rec.stats.totalGamesPlayed += 1;
      this.dataStore.addXpAndCheckAchievements(r.userId, r.netChips > 0 ? 30 : 10);
      this.dataStore.recordGameHistory(r.userId, {
        gameType: 'blackjack',
        roomName: room.name,
        netChips: r.netChips,
        summary: r.hadBlackjack
          ? `Natural Blackjack! Won ${r.netChips.toLocaleString()} chips`
          : r.netChips > 0
            ? `Won ${r.netChips.toLocaleString()} chips vs Dealer ${summary.dealerScore}`
            : r.netChips === 0
              ? `Push vs Dealer ${summary.dealerScore}`
              : `Lost ${Math.abs(r.netChips).toLocaleString()} chips vs Dealer ${summary.dealerScore}`,
      });
    }

    const timings = GAME_SPEED_CONFIG[room.gameSpeed];
    const pauseMs = timings.showWinnerMs + timings.nextHandDelayMs;
    engine.nextRoundAt = Date.now() + pauseMs;
    if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
    room.nextRoundTimer = setTimeout(() => {
      if (engine.seats.length > 0) {
        engine.startNewBettingRound();
        this.broadcastRoomState(room.id);
      }
    }, pauseMs);
  }

  // TOURNAMENTS (Single-Table Texas Hold'em)
  public createTournament(params: {
    creatorId: string;
    name: string;
    maxPlayers: number;
    startingChips?: number;
    startingSb?: number;
    startingBb?: number;
    blindIntervalMinutes?: number;
    anteEnabled?: boolean;
    entryFee?: number;
    visibility?: RoomVisibility;
    allowProbabilityAssist?: boolean;
    gameSpeed?: GameSpeed;
    startCondition?: 'auto_when_full' | 'host_or_full';
    initialBots?: number;
    botDifficulty?: BotDifficulty;
  }): { ok: boolean; tournament?: TournamentSummary; error?: string } {
    const creator = this.dataStore.users.get(params.creatorId);
    if (!creator) return { ok: false, error: 'Creator account not found' };

    const cleanName = params.name.trim();
    if (cleanName.length < 2 || cleanName.length > 60) {
      return { ok: false, error: 'Tournament name must be 2–60 characters' };
    }

    const maxPlayers = Math.max(2, Math.min(9, params.maxPlayers));
    const startingChips = Math.max(500, params.startingChips ?? 5000);
    const startingSb = Math.max(5, params.startingSb ?? 25);
    const startingBb = Math.max(startingSb * 2, params.startingBb ?? startingSb * 2);
    const blindIntervalMinutes = Math.max(1, Math.min(60, params.blindIntervalMinutes ?? 10));
    const entryFee = Math.max(0, Math.floor(params.entryFee ?? 0));

    if (entryFee > 0) {
      const debit = this.dataStore.mutateChips({
        userId: params.creatorId,
        delta: -entryFee,
        txType: 'tournament_buyin',
        description: `Tournament entry fee: ${cleanName}`,
      });
      if (!debit.ok) return { ok: false, error: debit.error || 'Insufficient chips for tournament entry fee' };
    }

    const code = generateSixCharCode(new Set(this.tournamentCodeToId.keys()));
    const id = randomUUID();
    const tourn: ManagedTournament = {
      id,
      code,
      name: cleanName,
      creatorId: params.creatorId,
      creatorUsername: creator.profile.username,
      visibility: params.visibility ?? 'public',
      maxPlayers,
      startingChips,
      startingSb,
      startingBb,
      blindIntervalMinutes,
      blindSchedule: buildDefaultBlindSchedule(startingSb, startingBb, blindIntervalMinutes, Boolean(params.anteEnabled)),
      anteEnabled: Boolean(params.anteEnabled),
      entryFee,
      allowProbabilityAssist: params.allowProbabilityAssist ?? true,
      gameSpeed: params.gameSpeed ?? 'normal',
      startCondition: params.startCondition ?? 'host_or_full',
      status: 'registering',
      currentLevel: 1,
      levelEndsAt: null,
      roomId: null,
      winnerId: null,
      winnerUsername: null,
      totalHandsPlayed: 0,
      players: new Map(),
      createdAt: new Date().toISOString(),
    };

    tourn.players.set(params.creatorId, {
      userId: params.creatorId,
      username: creator.profile.username,
      avatarId: creator.profile.avatarId,
      tournamentChips: startingChips,
      status: 'registered',
      placement: null,
      eliminations: 0,
      isBot: false,
    });

    const requestedBots = Math.max(0, Math.min(maxPlayers - 1, Math.floor(params.initialBots ?? 0)));
    for (let i = 0; i < requestedBots; i++) {
      const usedNames = new Set(Array.from(tourn.players.values()).map((p) => p.username));
      const persona = this.pickBotPersona(usedNames);
      const botId = `bot_${randomUUID().slice(0, 8)}`;
      tourn.players.set(botId, {
        userId: botId,
        username: persona.username,
        avatarId: persona.avatarId,
        tournamentChips: startingChips,
        status: 'registered',
        placement: null,
        eliminations: 0,
        isBot: true,
        botDifficulty: params.botDifficulty ?? 'normal',
      });
    }

    this.tournaments.set(id, tourn);
    this.tournamentCodeToId.set(code, id);
    this.broadcastLobbyUpdate();
    return { ok: true, tournament: this.summarizeTournament(tourn) };
  }

  public addBotToTournament(
    actorId: string,
    tournamentId: string,
    difficulty: BotDifficulty = 'normal'
  ): { ok: boolean; tournament?: TournamentSummary; botUserId?: string; error?: string } {
    const tourn = this.tournaments.get(tournamentId);
    if (!tourn) return { ok: false, error: 'Tournament not found' };
    if (tourn.creatorId !== actorId) return { ok: false, error: 'Only the tournament host can add bots' };
    if (tourn.status !== 'registering') return { ok: false, error: 'Bots can only be added before the tournament starts' };
    if (tourn.players.size >= tourn.maxPlayers) return { ok: false, error: 'Tournament is already full' };

    const usedNames = new Set(Array.from(tourn.players.values()).map((p) => p.username));
    const persona = this.pickBotPersona(usedNames);
    const botId = `bot_${randomUUID().slice(0, 8)}`;
    tourn.players.set(botId, {
      userId: botId,
      username: persona.username,
      avatarId: persona.avatarId,
      tournamentChips: tourn.startingChips,
      status: 'registered',
      placement: null,
      eliminations: 0,
      isBot: true,
      botDifficulty: difficulty || 'normal',
    });

    if (tourn.startCondition === 'auto_when_full' && tourn.players.size === tourn.maxPlayers) {
      this.startTournament(tourn.creatorId, tourn.id);
    } else {
      this.broadcastTournamentUpdate(tourn);
      this.broadcastLobbyUpdate();
    }

    return { ok: true, tournament: this.summarizeTournament(tourn), botUserId: botId };
  }

  public removeBotFromTournament(
    actorId: string,
    tournamentId: string,
    botUserId: string
  ): { ok: boolean; tournament?: TournamentSummary; error?: string } {
    const tourn = this.tournaments.get(tournamentId);
    if (!tourn) return { ok: false, error: 'Tournament not found' };
    if (tourn.creatorId !== actorId) return { ok: false, error: 'Only the tournament host can remove bots' };
    if (tourn.status !== 'registering') return { ok: false, error: 'Cannot remove bots after tournament start' };
    const player = tourn.players.get(botUserId);
    if (!player || !player.isBot) return { ok: false, error: 'Bot player not found' };

    tourn.players.delete(botUserId);
    this.broadcastTournamentUpdate(tourn);
    this.broadcastLobbyUpdate();
    return { ok: true, tournament: this.summarizeTournament(tourn) };
  }

  public joinTournament(userId: string, idOrCode: string): { ok: boolean; tournament?: TournamentSummary; error?: string } {
    const cleanRef = idOrCode.trim();
    const tid = this.tournamentCodeToId.get(cleanRef.toUpperCase()) ?? cleanRef;
    const tourn = this.tournaments.get(tid);
    if (!tourn) return { ok: false, error: 'Tournament not found' };

    if (tourn.players.has(userId)) {
      return { ok: true, tournament: this.summarizeTournament(tourn) };
    }
    if (tourn.status !== 'registering') {
      return { ok: false, error: 'Tournament registration is closed' };
    }
    if (tourn.players.size >= tourn.maxPlayers) {
      return { ok: false, error: 'Tournament is full' };
    }

    const user = this.dataStore.users.get(userId);
    if (!user) return { ok: false, error: 'Player not found' };

    if (tourn.entryFee > 0) {
      const debit = this.dataStore.mutateChips({
        userId,
        delta: -tourn.entryFee,
        txType: 'tournament_buyin',
        referenceId: tourn.id,
        description: `Tournament entry fee: ${tourn.name}`,
      });
      if (!debit.ok) return { ok: false, error: debit.error || 'Insufficient chips for entry fee' };
    }

    tourn.players.set(userId, {
      userId,
      username: user.profile.username,
      avatarId: user.profile.avatarId,
      tournamentChips: tourn.startingChips,
      status: 'registered',
      placement: null,
      eliminations: 0,
    });

    if (tourn.startCondition === 'auto_when_full' && tourn.players.size === tourn.maxPlayers) {
      this.startTournament(tourn.creatorId, tourn.id);
    } else {
      this.broadcastTournamentUpdate(tourn);
      this.broadcastLobbyUpdate();
    }

    return { ok: true, tournament: this.summarizeTournament(tourn) };
  }

  public leaveTournament(userId: string, tournamentId: string): { ok: boolean; error?: string } {
    const tourn = this.tournaments.get(tournamentId);
    if (!tourn) return { ok: false, error: 'Tournament not found' };
    if (tourn.status !== 'registering') {
      return { ok: false, error: 'Cannot unregister once tournament has started' };
    }
    if (!tourn.players.has(userId)) return { ok: false, error: 'Not registered' };

    tourn.players.delete(userId);
    if (tourn.entryFee > 0) {
      this.dataStore.mutateChips({
        userId,
        delta: tourn.entryFee,
        txType: 'tournament_payout',
        referenceId: tourn.id,
        description: `Refunded entry fee for ${tourn.name}`,
      });
    }
    this.broadcastTournamentUpdate(tourn);
    this.broadcastLobbyUpdate();
    return { ok: true };
  }

  public startTournament(userId: string, tournamentId: string): { ok: boolean; tournament?: TournamentSummary; error?: string } {
    const tourn = this.tournaments.get(tournamentId);
    if (!tourn) return { ok: false, error: 'Tournament not found' };
    if (tourn.creatorId !== userId) return { ok: false, error: 'Only the tournament creator can start it' };
    if (tourn.status !== 'registering') return { ok: false, error: 'Tournament already started' };
    if (tourn.players.size < 2) return { ok: false, error: 'Need at least 2 players to start tournament' };

    const roomRes = this.createRoom({
      hostId: tourn.creatorId,
      name: tourn.name,
      gameType: 'holdem',
      visibility: tourn.visibility,
      maxPlayers: tourn.maxPlayers,
      smallBlind: tourn.startingSb,
      bigBlind: tourn.startingBb,
      minBuyin: tourn.startingChips,
      maxBuyin: tourn.startingChips,
      gameSpeed: tourn.gameSpeed,
      allowProbabilityAssist: tourn.allowProbabilityAssist,
      tournamentId: tourn.id,
    });

    if (!roomRes.ok || !roomRes.room) {
      return { ok: false, error: roomRes.error || 'Failed to create tournament table' };
    }

    const room = this.rooms.get(roomRes.room.id)!;
    const engine = room.pokerEngine!;
    engine.ante = tourn.anteEnabled ? tourn.blindSchedule[0].ante : 0;

    for (const p of tourn.players.values()) {
      p.status = 'active';
      p.tournamentChips = tourn.startingChips;
      engine.addPlayer(p.userId, p.username, p.avatarId, tourn.startingChips, undefined, {
        isBot: p.isBot,
        botDifficulty: p.botDifficulty,
      });
      if (!p.isBot) {
        const rec = this.dataStore.users.get(p.userId);
        if (rec) rec.stats.tournamentsPlayed += 1;
      }
    }

    tourn.status = 'in_progress';
    tourn.roomId = room.id;
    tourn.currentLevel = 1;
    tourn.levelEndsAt = new Date(Date.now() + tourn.blindIntervalMinutes * 60_000).toISOString();

    room.status = 'active';
    engine.startNewHand();
    this.schedulePokerTimers(room);
    this.scheduleBlindLevelTimer(tourn);

    this.broadcastRoomState(room.id);
    this.broadcastTournamentUpdate(tourn);
    this.broadcastLobbyUpdate();
    return { ok: true, tournament: this.summarizeTournament(tourn) };
  }

  private scheduleBlindLevelTimer(tourn: ManagedTournament): void {
    if (tourn.blindTimer) clearInterval(tourn.blindTimer);
    tourn.blindTimer = setInterval(() => {
      if (tourn.status !== 'in_progress') {
        if (tourn.blindTimer) clearInterval(tourn.blindTimer);
        return;
      }
      if (tourn.levelEndsAt && Date.now() >= new Date(tourn.levelEndsAt).getTime()) {
        if (tourn.currentLevel < tourn.blindSchedule.length) {
          tourn.currentLevel += 1;
        }
        tourn.levelEndsAt = new Date(Date.now() + tourn.blindIntervalMinutes * 60_000).toISOString();
        this.broadcastTournamentUpdate(tourn);
      }
    }, 5_000);
  }

  private syncTournamentAfterHand(tourn: ManagedTournament, engine: PokerTableEngine): void {
    const alivePlayersBefore = Array.from(tourn.players.values()).filter((p) => p.status === 'active').length;
    const newlyEliminated: string[] = [];

    for (const p of tourn.players.values()) {
      const seat = engine.seats.find((s) => s.userId === p.userId);
      if (seat) {
        p.tournamentChips = seat.chips;
        if (seat.chips <= 0 && p.status === 'active') {
          p.status = 'eliminated';
          newlyEliminated.push(p.userId);
        }
      }
    }

    if (newlyEliminated.length > 0) {
      let place = alivePlayersBefore;
      for (const uid of newlyEliminated) {
        const p = tourn.players.get(uid)!;
        p.placement = place;
        place -= 1;
      }
    }

    const remainingActive = Array.from(tourn.players.values()).filter((p) => p.status === 'active');
    if (remainingActive.length === 1) {
      const winner = remainingActive[0];
      winner.status = 'winner';
      winner.placement = 1;
      winner.eliminations = tourn.players.size - 1;
      tourn.status = 'completed';
      tourn.winnerId = winner.userId;
      tourn.winnerUsername = winner.username;
      if (tourn.blindTimer) clearInterval(tourn.blindTimer);

      const rec = this.dataStore.users.get(winner.userId);
      if (rec && !winner.isBot) {
        rec.stats.tournamentsWon += 1;
        this.dataStore.addXpAndCheckAchievements(winner.userId, 150);
      }

      const humanEntrants = Array.from(tourn.players.values()).filter((p) => !p.isBot).length;
      const prizePool = tourn.entryFee * humanEntrants;
      if (prizePool > 0 && !winner.isBot) {
        this.dataStore.mutateChips({
          userId: winner.userId,
          delta: prizePool,
          txType: 'tournament_payout',
          referenceId: tourn.id,
          description: `1st Place Tournament Prize: ${tourn.name}`,
        });
      }

      if (!winner.isBot) {
        this.dataStore.addNotification(
          winner.userId,
          'tournament_win',
          'Tournament Champion!',
          `You won ${tourn.name}${prizePool > 0 ? ` and earned ${prizePool.toLocaleString()} virtual chips` : ''}!`
        );
      }
    }

    this.broadcastTournamentUpdate(tourn);
  }

  public getRoomPlayerCount(room: ManagedRoom): number {
    if (room.gameType === 'holdem' && room.pokerEngine) return room.pokerEngine.seats.length;
    if (room.gameType === 'blackjack' && room.blackjackEngine) return room.blackjackEngine.seats.length;
    return 0;
  }

  public summarizeRoom(room: ManagedRoom): GameRoomSummary {
    const players =
      room.gameType === 'holdem' && room.pokerEngine
        ? room.pokerEngine.seats.map((s) => ({
            userId: s.userId,
            username: s.username,
            avatarId: s.avatarId,
            seatIndex: s.seatIndex,
            chips: s.chips,
            isHost: s.userId === room.hostId,
            isBot: Boolean(s.isBot),
            botDifficulty: s.botDifficulty,
            status: s.sittingOut ? 'sitting_out' : s.disconnected ? 'disconnected' : 'seated',
          }))
        : room.blackjackEngine
          ? room.blackjackEngine.seats.map((s) => ({
              userId: s.userId,
              username: s.username,
              avatarId: s.avatarId,
              seatIndex: s.seatIndex,
              chips: s.tableChips,
              isHost: s.userId === room.hostId,
              status: s.disconnected ? 'disconnected' : 'seated',
            }))
          : [];

    return {
      id: room.id,
      code: room.code,
      name: room.name,
      gameType: room.gameType,
      visibility: room.visibility,
      hasPassword: Boolean(room.passwordHash),
      hostId: room.hostId,
      hostUsername: room.hostUsername,
      maxPlayers: room.maxPlayers,
      playerCount: players.length,
      smallBlind: room.smallBlind,
      bigBlind: room.bigBlind,
      minBuyin: room.minBuyin,
      maxBuyin: room.maxBuyin,
      gameSpeed: room.gameSpeed,
      allowProbabilityAssist: room.allowProbabilityAssist,
      status: room.status,
      tournamentId: room.tournamentId,
      players,
      createdAt: room.createdAt,
    };
  }

  public summarizeTournament(tourn: ManagedTournament): TournamentSummary {
    const players = Array.from(tourn.players.values()).sort((a, b) => {
      if (a.placement && b.placement) return a.placement - b.placement;
      return b.tournamentChips - a.tournamentChips;
    });
    return {
      id: tourn.id,
      code: tourn.code,
      name: tourn.name,
      creatorId: tourn.creatorId,
      creatorUsername: tourn.creatorUsername,
      visibility: tourn.visibility,
      maxPlayers: tourn.maxPlayers,
      registeredCount: tourn.players.size,
      startingChips: tourn.startingChips,
      startingSb: tourn.startingSb,
      startingBb: tourn.startingBb,
      blindIntervalMinutes: tourn.blindIntervalMinutes,
      blindSchedule: tourn.blindSchedule,
      anteEnabled: tourn.anteEnabled,
      entryFee: tourn.entryFee,
      allowProbabilityAssist: tourn.allowProbabilityAssist,
      gameSpeed: tourn.gameSpeed,
      startCondition: tourn.startCondition,
      status: tourn.status,
      currentLevel: tourn.currentLevel,
      levelEndsAt: tourn.levelEndsAt,
      roomId: tourn.roomId,
      winnerId: tourn.winnerId,
      winnerUsername: tourn.winnerUsername,
      totalHandsPlayed: tourn.totalHandsPlayed,
      players,
      createdAt: tourn.createdAt,
    };
  }

  public getActiveRoomForUser(userId: string): GameRoomSummary | null {
    for (const room of this.rooms.values()) {
      const inPoker = room.pokerEngine?.seats.some((s) => s.userId === userId);
      const inBj = room.blackjackEngine?.seats.some((s) => s.userId === userId);
      if (inPoker || inBj) return this.summarizeRoom(room);
    }
    return null;
  }

  // WEBSOCKET CONNECTION MANAGEMENT
  public registerWsClient(ws: WebSocket, userId: string): WsClientMeta {
    const meta: WsClientMeta = { ws, userId, roomId: null, tournamentId: null };
    this.clients.add(meta);
    this.dataStore.onlineUsers.set(userId, { lastPing: Date.now() });
    return meta;
  }

  public unregisterWsClient(meta: WsClientMeta): void {
    this.clients.delete(meta);
    const hasOtherConn = Array.from(this.clients).some((c) => c.userId === meta.userId);
    if (!hasOtherConn && meta.roomId) {
      const room = this.rooms.get(meta.roomId);
      if (room?.pokerEngine) {
        room.pokerEngine.setDisconnected(meta.userId, true);
        this.broadcastRoomState(room.id);
      }
      if (room?.blackjackEngine) {
        const s = room.blackjackEngine.seats.find((x) => x.userId === meta.userId);
        if (s) {
          s.disconnected = true;
          this.broadcastRoomState(room.id);
        }
      }
    }
  }

  public subscribeClientToRoom(meta: WsClientMeta, roomId: string | null): void {
    meta.roomId = roomId;
    if (roomId) {
      const room = this.rooms.get(roomId);
      if (room) {
        this.sendRoomSnapshotToClient(meta, room);
      }
    }
  }

  public subscribeClientToTournament(meta: WsClientMeta, tournamentId: string | null): void {
    meta.tournamentId = tournamentId;
    if (tournamentId) {
      const tourn = this.tournaments.get(tournamentId);
      if (tourn) {
        this.sendJson(meta.ws, { type: 'tournament:state', tournament: this.summarizeTournament(tourn) });
      }
    }
  }

  public broadcastRoomState(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const client of this.clients) {
      if (client.roomId === roomId) {
        this.sendRoomSnapshotToClient(client, room);
      }
    }
  }

  private sendRoomSnapshotToClient(client: WsClientMeta, room: ManagedRoom): void {
    const summary = this.summarizeRoom(room);
    if (room.gameType === 'holdem' && room.pokerEngine) {
      this.sendJson(client.ws, {
        type: 'room:state',
        room: summary,
        poker: room.pokerEngine.toPlayerView(client.userId),
      });
    } else if (room.gameType === 'blackjack' && room.blackjackEngine) {
      this.sendJson(client.ws, {
        type: 'room:state',
        room: summary,
        blackjack: room.blackjackEngine.toTableView(),
      });
    }
  }

  public broadcastRoomChat(roomId: string, message: unknown): void {
    for (const client of this.clients) {
      if (client.roomId === roomId) {
        this.sendJson(client.ws, { type: 'chat:message', message });
      }
    }
  }

  public broadcastTournamentUpdate(tourn: ManagedTournament): void {
    const summary = this.summarizeTournament(tourn);
    for (const client of this.clients) {
      if (client.tournamentId === tourn.id || (tourn.roomId && client.roomId === tourn.roomId)) {
        this.sendJson(client.ws, { type: 'tournament:state', tournament: summary });
      }
    }
  }

  public broadcastLobbyUpdate(): void {
    const publicRooms = Array.from(this.rooms.values())
      .filter((r) => r.visibility === 'public' && r.status !== 'closed')
      .map((r) => this.summarizeRoom(r));
    const publicTournaments = Array.from(this.tournaments.values())
      .filter((t) => t.visibility === 'public')
      .map((t) => this.summarizeTournament(t));

    for (const client of this.clients) {
      this.sendJson(client.ws, { type: 'lobby:update', rooms: publicRooms, tournaments: publicTournaments });
    }
  }

  public notifyUser(userId: string, payload: unknown): void {
    for (const client of this.clients) {
      if (client.userId === userId) {
        this.sendJson(client.ws, payload);
      }
    }
  }

  private sendJson(ws: WebSocket, data: unknown): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }
}
