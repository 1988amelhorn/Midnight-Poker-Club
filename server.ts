import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ServerDataStore, type StoredUserRecord } from './server/dataStore.ts';
import { GameManager, type GameManagerOptions } from './server/gameManager.ts';
import type { BotDifficulty } from './src/shared/types.ts';
import {
  hasSupabasePublicKey,
  hasSupabaseServiceRole,
  hasSupabaseUrl,
  isSupabaseAuthEnabled,
  isSupabaseConfigured,
  publicSupabaseConfig,
  supabaseAdmin,
} from './server/supabaseAdmin.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AuthedRequest extends Request {
  authUser?: StoredUserRecord;
}

export function createNeonPokerServer(options?: GameManagerOptions) {
  const app = express();
  // Allow only configured browser frontend origins when hosting the API
  // separately. Same-origin requests work without any configuration.
  const allowedOrigins = new Set(
    [process.env.FRONTEND_ORIGIN, process.env.APP_URL]
      .filter(Boolean)
      .flatMap((value) => value!.split(','))
      .map((value) => value.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(origin && !allowedOrigins.has(origin) ? 403 : 204);
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  const dataStore = new ServerDataStore();
  const gameManager = new GameManager(dataStore, options);

  // Simple sliding-window API rate limiter
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  function rateLimit(maxReqs: number, windowMs: number) {
    return (req: Request, res: Response, next: NextFunction) => {
      const key = `${req.ip}:${req.path}`;
      const now = Date.now();
      const bucket = rateBuckets.get(key);
      if (!bucket || now > bucket.resetAt) {
        rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
        return next();
      }
      bucket.count += 1;
      if (bucket.count > maxReqs) {
        return res.status(429).json({ error: 'Too many requests. Please slow down.' });
      }
      return next();
    };
  }

  async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const user = await dataStore.authenticateToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    if (user.profile.isSuspended) {
      return res.status(403).json({ error: 'Account is suspended' });
    }
    req.authUser = user;
    dataStore.onlineUsers.set(user.profile.id, {
      ...(dataStore.onlineUsers.get(user.profile.id) ?? {}),
      lastPing: Date.now(),
    });
    return next();
  }

  function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
    if (!req.authUser || req.authUser.profile.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator privileges required' });
    }
    return next();
  }

  // HEALTH & PUBLIC CONFIG
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      supabaseConfigured: isSupabaseConfigured,
      supabaseAuthEnabled: isSupabaseAuthEnabled,
      mode: isSupabaseConfigured ? 'supabase' : isSupabaseAuthEnabled ? 'supabase-auth' : 'local-server-authoritative',
      uptimeSeconds: Math.floor(process.uptime()),
      activeRooms: gameManager.rooms.size,
      activeTournaments: gameManager.tournaments.size,
    });
  });

  app.get('/api/public-config', (_req, res) => {
    res.json({
      supabaseConfigured: isSupabaseConfigured,
      supabaseAuthEnabled: isSupabaseAuthEnabled,
      hasSupabaseUrl,
      hasSupabasePublicKey,
      hasServiceRoleKey: hasSupabaseServiceRole,
      supabaseUrl: publicSupabaseConfig.supabaseUrl,
      supabaseAnonKey: publicSupabaseConfig.supabaseAnonKey,
      maintenanceMode: dataStore.globalSettings.maintenanceMode,
    });
  });

  // AUTH ROUTES
  app.get('/api/auth/check-username', async (req, res) => {
    const username = String(req.query.username || '');
    const available = await dataStore.isUsernameAvailableAsync(username);
    res.json({ available, valid: /^[a-zA-Z0-9_]{3,24}$/.test(username.trim()) });
  });

  app.post('/api/auth/register', rateLimit(20, 60_000), async (req, res) => {
    const { email, password, username, avatarId } = req.body || {};
    if (isSupabaseConfigured && supabaseAdmin) {
      if (!(await dataStore.isUsernameAvailableAsync(String(username || '')))) {
        return res.status(409).json({ error: 'That username is already taken' });
      }
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: String(email || '').trim().toLowerCase(),
        password: String(password || ''),
        email_confirm: false,
        user_metadata: { username: String(username || '').trim(), avatarId: avatarId || 'ace-spade' },
      });
      if (error || !data.user) {
        return res.status(400).json({ error: error?.message || 'Registration failed' });
      }
      const synced = await dataStore.ensureSupabaseUserSynced(data.user.id, data.user.email || '', { username, avatarId });
      return res.status(201).json({
        user: synced.profile,
        wallet: synced.wallet,
        stats: synced.stats,
        requiresEmailVerification: true,
      });
    }

    const result = dataStore.registerLocalUser({
      email: String(email || ''),
      password: String(password || ''),
      username: String(username || ''),
      avatarId: typeof avatarId === 'string' ? avatarId : 'ace-spade',
    });
    if (!result.ok || !result.user) {
      return res.status(400).json({ error: result.error });
    }
    return res.status(201).json({
      token: result.token,
      user: result.user.profile,
      wallet: result.user.wallet,
      stats: result.user.stats,
      achievements: result.user.achievements,
      requiresEmailVerification: false,
    });
  });

  app.post('/api/auth/login', rateLimit(30, 60_000), (req, res) => {
    const { email, password } = req.body || {};
    const result = dataStore.loginLocalUser(String(email || ''), String(password || ''));
    if (!result.ok || !result.user) {
      return res.status(401).json({ error: result.error });
    }
    return res.json({
      token: result.token,
      user: result.user.profile,
      wallet: result.user.wallet,
      stats: result.user.stats,
      achievements: result.user.achievements,
    });
  });

  app.post('/api/auth/reset-password', rateLimit(10, 60_000), async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    if (isSupabaseConfigured && supabaseAdmin) {
      const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.APP_URL || 'http://localhost:3000'}/#reset-password`,
      });
      if (error) return res.status(400).json({ error: error.message });
    }
    dataStore.log('info', 'auth', `Password reset requested for ${email}`);
    return res.json({
      ok: true,
      message: isSupabaseConfigured
        ? 'If an account matches that email, a password reset link has been sent.'
        : 'Password reset initiated. In preview mode without SMTP, contact an administrator or use a connected Supabase project for email delivery.',
    });
  });

  app.get('/api/auth/session', requireAuth, (req: AuthedRequest, res) => {
    const u = req.authUser!;
    res.json({
      user: u.profile,
      wallet: u.wallet,
      stats: u.stats,
      achievements: u.achievements,
      activeRoom: gameManager.getActiveRoomForUser(u.profile.id),
    });
  });

  app.patch('/api/profile', requireAuth, (req: AuthedRequest, res) => {
    const resUpdate = dataStore.updateProfile(req.authUser!.profile.id, req.body || {});
    if (!resUpdate.ok) return res.status(400).json({ error: resUpdate.error });
    return res.json({ user: resUpdate.profile });
  });

  app.delete('/api/account', requireAuth, async (req: AuthedRequest, res) => {
    const uid = req.authUser!.profile.id;
    const active = gameManager.getActiveRoomForUser(uid);
    if (active) {
      gameManager.leaveRoom(uid, active.id);
    }
    dataStore.deleteUserAccount(uid);
    if (isSupabaseConfigured && supabaseAdmin) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
    }
    return res.json({ ok: true });
  });

  // WALLET & BONUSES
  app.get('/api/wallet', requireAuth, (req: AuthedRequest, res) => {
    const uid = req.authUser!.profile.id;
    res.json({
      wallet: req.authUser!.wallet,
      transactions: dataStore.transactions.get(uid) ?? [],
      dailyClaims: dataStore.dailyBonusHistory.get(uid) ?? [],
    });
  });

  app.post('/api/wallet/welcome-bonus', requireAuth, rateLimit(10, 60_000), (req: AuthedRequest, res) => {
    const result = dataStore.claimWelcomeBonus(req.authUser!.profile.id);
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  });

  app.post('/api/wallet/daily-bonus', requireAuth, rateLimit(15, 60_000), (req: AuthedRequest, res) => {
    const result = dataStore.claimDailyBonus(req.authUser!.profile.id);
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  });

  app.post('/api/wallet/transfer', requireAuth, rateLimit(20, 60_000), (req: AuthedRequest, res) => {
    const { recipientId, amount, idempotencyKey } = req.body || {};
    const result = dataStore.transferChipsBetweenFriends(
      req.authUser!.profile.id,
      String(recipientId || ''),
      Number(amount || 0),
      typeof idempotencyKey === 'string' ? idempotencyKey : undefined
    );
    if (!result.ok) return res.status(400).json({ error: result.error });
    gameManager.notifyUser(String(recipientId), { type: 'wallet:refresh' });
    return res.json({ ok: true, newBalance: result.senderBalance });
  });

  // ROOMS (Public & Private Poker / Blackjack)
  app.get('/api/rooms', requireAuth, (req: AuthedRequest, res) => {
    const uid = req.authUser!.profile.id;
    const gameType = req.query.gameType ? String(req.query.gameType) : null;
    const rooms = Array.from(gameManager.rooms.values())
      .filter((r) => r.status !== 'closed' && (r.visibility === 'public' || r.hostId === uid || r.pokerEngine?.seats.some((s) => s.userId === uid) || r.blackjackEngine?.seats.some((s) => s.userId === uid)))
      .filter((r) => (!gameType || r.gameType === gameType))
      .map((r) => gameManager.summarizeRoom(r));
    res.json({ rooms, activeRoom: gameManager.getActiveRoomForUser(uid) });
  });

  app.post('/api/rooms', requireAuth, rateLimit(20, 60_000), (req: AuthedRequest, res) => {
    const body = req.body || {};
    const created = gameManager.createRoom({
      hostId: req.authUser!.profile.id,
      name: String(body.name || 'Midnight Table'),
      gameType: body.gameType === 'blackjack' ? 'blackjack' : 'holdem',
      visibility: body.visibility === 'private' ? 'private' : 'public',
      maxPlayers: Number(body.maxPlayers || 6),
      password: body.password ? String(body.password) : undefined,
      smallBlind: Number(body.smallBlind || 25),
      bigBlind: Number(body.bigBlind || 50),
      minBuyin: Number(body.minBuyin || 500),
      maxBuyin: Number(body.maxBuyin || 5000),
      gameSpeed: body.gameSpeed === 'relaxed' || body.gameSpeed === 'fast' ? body.gameSpeed : 'normal',
      allowProbabilityAssist: body.allowProbabilityAssist !== false,
    });
    if (!created.ok || !created.room) return res.status(400).json({ error: created.error });

    // Auto-seat creator if buy-in specified or default
    const buyin = body.buyinAmount !== undefined ? Number(body.buyinAmount) : created.room.minBuyin;
    const joined = gameManager.joinRoom({
      userId: req.authUser!.profile.id,
      roomIdOrCode: created.room.id,
      password: body.password ? String(body.password) : undefined,
      buyinAmount: buyin,
    });
    if (!joined.ok) return res.status(400).json({ error: joined.error });

    let latestRoom = joined.room!;
    const botDifficulty: BotDifficulty =
      body.botDifficulty === 'easy' || body.botDifficulty === 'hard' ? body.botDifficulty : 'normal';
    const initialBots = Math.max(0, Math.min(latestRoom.maxPlayers - 1, Math.floor(Number(body.initialBots || 0))));
    if (latestRoom.gameType === 'holdem' && initialBots > 0) {
      for (let i = 0; i < initialBots; i++) {
        const added = gameManager.addBotToRoom(req.authUser!.profile.id, latestRoom.id, botDifficulty);
        if (added.ok && added.room) latestRoom = added.room;
      }
    }

    return res.status(201).json({ room: latestRoom, wallet: req.authUser!.wallet });
  });

  app.post('/api/rooms/join', requireAuth, (req: AuthedRequest, res) => {
    const { roomIdOrCode, password, buyinAmount, friendId } = req.body || {};
    const friend = typeof friendId === 'string' ? friendId : '';
    const targetRoom = gameManager.rooms.get(String(roomIdOrCode || ''));
    const acceptedFriend = Boolean(friend && dataStore.areFriends(req.authUser!.profile.id, friend));
    const friendInvited = Boolean(targetRoom && acceptedFriend &&
      (targetRoom.hostId === friend ||
        targetRoom.pokerEngine?.seats.some((s) => s.userId === friend) ||
        targetRoom.blackjackEngine?.seats.some((s) => s.userId === friend)));
    if (friend && !friendInvited) return res.status(403).json({ error: 'Friend invitation is not valid for this table' });
    const joined = gameManager.joinRoom({
      userId: req.authUser!.profile.id,
      roomIdOrCode: String(roomIdOrCode || ''),
      password: password ? String(password) : undefined,
      friendInvited,
      buyinAmount: buyinAmount !== undefined ? Number(buyinAmount) : undefined,
    });
    if (!joined.ok) return res.status(400).json({ error: joined.error });
    return res.json({ room: joined.room, wallet: req.authUser!.wallet });
  });

  app.get('/api/rooms/:id', requireAuth, (req: AuthedRequest, res) => {
    const room = gameManager.rooms.get(String(req.params.id));
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const uid = req.authUser!.profile.id;
    const isMember =
      room.visibility === 'public' ||
      room.hostId === uid ||
      room.pokerEngine?.seats.some((s) => s.userId === uid) ||
      room.blackjackEngine?.seats.some((s) => s.userId === uid);
    if (!isMember) return res.status(403).json({ error: 'Private room access requires invitation code' });

    res.json({
      room: gameManager.summarizeRoom(room),
      poker: room.pokerEngine ? room.pokerEngine.toPlayerView(uid) : null,
      blackjack: room.blackjackEngine ? room.blackjackEngine.toTableView() : null,
      chat: dataStore.chatMessages.get(`room:${room.id}`) ?? [],
    });
  });

  // Read-only live spectator view. Only an accepted friend of a seated human
  // may watch. Never place the viewer at the table or expose private room codes.
  app.get('/api/rooms/:id/spectate', requireAuth, (req: AuthedRequest, res) => {
    const viewerId = req.authUser!.profile.id;
    const friendId = String(req.query.friendId || '');
    const room = gameManager.rooms.get(String(req.params.id));
    if (!room || room.status === 'closed') {
      return res.status(404).json({ error: 'This game is no longer available' });
    }
    if (!friendId || friendId === viewerId || !dataStore.areFriends(viewerId, friendId)) {
      return res.status(403).json({ error: 'Only accepted friends may spectate this game' });
    }
    const friendIsPlaying = room.pokerEngine?.seats.some((s) => s.userId === friendId)
      || room.blackjackEngine?.seats.some((s) => s.userId === friendId);
    if (!friendIsPlaying) {
      return res.status(403).json({ error: 'Your friend is no longer at this table' });
    }
    const poker = room.pokerEngine ? room.pokerEngine.toPlayerView(viewerId) : null;
    if (poker) {
      // Spectators have no valid actions or personal hand odds.
      poker.legalActions = null;
      poker.handStrength = null;
      for (const seat of poker.seats) {
        // Cards are only visible at a legitimate public showdown.
        if (poker.street !== 'showdown') seat.holeCards = null;
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      room: { ...gameManager.summarizeRoom(room), code: '' },
      poker,
      blackjack: room.blackjackEngine ? room.blackjackEngine.toTableView() : null,
      friendId,
    });
  });

  app.post('/api/rooms/:id/leave', requireAuth, (req: AuthedRequest, res) => {
    const result = gameManager.leaveRoom(req.authUser!.profile.id, String(req.params.id));
    res.json({ ...result, wallet: req.authUser!.wallet });
  });

  app.post('/api/rooms/:id/start', requireAuth, (req: AuthedRequest, res) => {
    const result = gameManager.startRoomGame(req.authUser!.profile.id, String(req.params.id));
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  });

  app.post('/api/rooms/:id/speed', requireAuth, (req: AuthedRequest, res) => {
    const speed = req.body?.speed;
    if (speed !== 'relaxed' && speed !== 'normal' && speed !== 'fast') {
      return res.status(400).json({ error: 'Invalid speed setting' });
    }
    const result = gameManager.setRoomSpeed(req.authUser!.profile.id, String(req.params.id), speed);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  });

  app.post('/api/rooms/:id/probability-assist', requireAuth, (req: AuthedRequest, res) => {
    const result = gameManager.setProbabilityAssist(req.authUser!.profile.id, String(req.params.id), Boolean(req.body?.enabled));
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  });

  app.post('/api/rooms/:id/bots', requireAuth, (req: AuthedRequest, res) => {
    const rawDiff = req.body?.difficulty;
    const difficulty: BotDifficulty = rawDiff === 'easy' || rawDiff === 'hard' ? rawDiff : 'normal';
    const result = gameManager.addBotToRoom(req.authUser!.profile.id, String(req.params.id), difficulty);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.delete('/api/rooms/:id/bots/:botId', requireAuth, (req: AuthedRequest, res) => {
    const result = gameManager.removeBotFromRoom(req.authUser!.profile.id, String(req.params.id), String(req.params.botId));
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  });

  app.patch('/api/rooms/:id/bots/:botId/difficulty', requireAuth, (req: AuthedRequest, res) => {
    const rawDiff = req.body?.difficulty;
    if (rawDiff !== 'easy' && rawDiff !== 'normal' && rawDiff !== 'hard') {
      return res.status(400).json({ error: 'Invalid bot difficulty (must be easy, normal, or hard)' });
    }
    const result = gameManager.setRoomBotDifficulty(
      req.authUser!.profile.id,
      String(req.params.id),
      String(req.params.botId),
      rawDiff
    );
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  });

  app.post('/api/rooms/:id/poker/action', requireAuth, (req: AuthedRequest, res) => {
    const { action, amount, actionId } = req.body || {};
    const result = gameManager.handlePokerAction(req.authUser!.profile.id, String(req.params.id), action, amount, actionId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  });

  app.post('/api/rooms/:id/poker/sit-out', requireAuth, (req: AuthedRequest, res) => {
    gameManager.handlePokerSitOut(req.authUser!.profile.id, String(req.params.id), Boolean(req.body?.sittingOut));
    res.json({ ok: true });
  });

  app.post('/api/rooms/:id/blackjack/action', requireAuth, (req: AuthedRequest, res) => {
    const { action, amount, actionId } = req.body || {};
    const result = gameManager.handleBlackjackAction(req.authUser!.profile.id, String(req.params.id), action, amount, actionId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  });

  // TOURNAMENTS
  app.get('/api/tournaments', requireAuth, (req: AuthedRequest, res) => {
    const uid = req.authUser!.profile.id;
    const list = Array.from(gameManager.tournaments.values())
      .filter((t) => t.visibility === 'public' || t.creatorId === uid || t.players.has(uid))
      .map((t) => gameManager.summarizeTournament(t));
    res.json({ tournaments: list });
  });

  app.post('/api/tournaments', requireAuth, (req: AuthedRequest, res) => {
    const body = req.body || {};
    const created = gameManager.createTournament({
      creatorId: req.authUser!.profile.id,
      name: String(body.name || 'Midnight Showdown'),
      maxPlayers: Number(body.maxPlayers || 8),
      startingChips: Number(body.startingChips || 5000),
      startingSb: Number(body.startingSb || 25),
      startingBb: Number(body.startingBb || 50),
      blindIntervalMinutes: Number(body.blindIntervalMinutes || 10),
      anteEnabled: Boolean(body.anteEnabled),
      entryFee: Number(body.entryFee || 0),
      visibility: body.visibility === 'private' ? 'private' : 'public',
      allowProbabilityAssist: body.allowProbabilityAssist !== false,
      gameSpeed: body.gameSpeed === 'relaxed' || body.gameSpeed === 'fast' ? body.gameSpeed : 'normal',
      startCondition: body.startCondition === 'auto_when_full' ? 'auto_when_full' : 'host_or_full',
      initialBots: Number(body.initialBots || 0),
      botDifficulty: body.botDifficulty === 'easy' || body.botDifficulty === 'hard' ? body.botDifficulty : 'normal',
    });
    if (!created.ok) return res.status(400).json({ error: created.error });
    return res.status(201).json({ tournament: created.tournament, wallet: req.authUser!.wallet });
  });

  app.post('/api/tournaments/:id/bots', requireAuth, (req: AuthedRequest, res) => {
    const rawDiff = req.body?.difficulty;
    const difficulty: BotDifficulty = rawDiff === 'easy' || rawDiff === 'hard' ? rawDiff : 'normal';
    const result = gameManager.addBotToTournament(req.authUser!.profile.id, String(req.params.id), difficulty);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.status(201).json(result);
  });

  app.delete('/api/tournaments/:id/bots/:botId', requireAuth, (req: AuthedRequest, res) => {
    const result = gameManager.removeBotFromTournament(req.authUser!.profile.id, String(req.params.id), String(req.params.botId));
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  });

  app.post('/api/tournaments/join', requireAuth, (req: AuthedRequest, res) => {
    const result = gameManager.joinTournament(req.authUser!.profile.id, String(req.body?.idOrCode || ''));
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ tournament: result.tournament, wallet: req.authUser!.wallet });
  });

  app.post('/api/tournaments/:id/leave', requireAuth, (req: AuthedRequest, res) => {
    const result = gameManager.leaveTournament(req.authUser!.profile.id, String(req.params.id));
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ok: true, wallet: req.authUser!.wallet });
  });

  app.post('/api/tournaments/:id/start', requireAuth, (req: AuthedRequest, res) => {
    const result = gameManager.startTournament(req.authUser!.profile.id, String(req.params.id));
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  });

  app.get('/api/tournaments/:id', requireAuth, (req: AuthedRequest, res) => {
    const tourn = gameManager.tournaments.get(String(req.params.id));
    if (!tourn) return res.status(404).json({ error: 'Tournament not found' });
    res.json({
      tournament: gameManager.summarizeTournament(tourn),
      chat: dataStore.chatMessages.get(`tournament:${tourn.id}`) ?? [],
    });
  });

  // FRIENDS & INVITES
  app.get('/api/friends', requireAuth, (req: AuthedRequest, res) => {
    const uid = req.authUser!.profile.id;
    const incoming = Array.from(dataStore.friendRequests.values()).filter((r) => r.receiverId === uid && r.status === 'pending');
    const outgoing = Array.from(dataStore.friendRequests.values()).filter((r) => r.senderId === uid && r.status === 'pending');
    res.json({
      friends: dataStore.getFriendsList(uid),
      incomingRequests: incoming,
      outgoingRequests: outgoing,
    });
  });

  // A friend may see a friend's active table, or a private table that their
  // friend owns even after a hand ends and everyone has temporarily left.
  app.get('/api/friends/tables', requireAuth, (req: AuthedRequest, res) => {
    const viewerId = req.authUser!.profile.id;
    const friends = dataStore.getFriendsList(viewerId).map((friend) => {
      const current = friend.currentRoomId ? gameManager.rooms.get(friend.currentRoomId) : null;
      const room = current && current.status !== 'closed' ? current
        : Array.from(gameManager.rooms.values()).find((r) =>
            r.hostId === friend.userId && r.status !== 'closed' && !r.tournamentId
          );
      if (!room) return { ...friend, currentRoomId: null, currentRoomName: null, canJoin: false, canWatch: false };
      const count = gameManager.summarizeRoom(room).playerCount;
      return {
        ...friend,
        currentRoomId: room.id,
        currentRoomName: room.name,
        canJoin: count < room.maxPlayers && !room.tournamentId,
        canWatch: Boolean(room.pokerEngine?.seats.some((s) => s.userId === friend.userId)
          || room.blackjackEngine?.seats.some((s) => s.userId === friend.userId)),
        roomPlayerCount: count,
        roomMaxPlayers: room.maxPlayers,
      };
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ friends });
  });

  app.get('/api/players/search', requireAuth, (req: AuthedRequest, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const uid = req.authUser!.profile.id;
    if (q.length < 2) return res.json({ players: [] });
    const matches = Array.from(dataStore.users.values())
      .filter((u) => u.profile.id !== uid && !u.profile.isSuspended && u.profile.username.toLowerCase().includes(q))
      .slice(0, 20)
      .map((u) => ({
        userId: u.profile.id,
        username: u.profile.username,
        avatarId: u.profile.avatarId,
        level: u.profile.level,
        isFriend: dataStore.areFriends(uid, u.profile.id),
      }));
    return res.json({ players: matches });
  });

  app.post('/api/friends/request', requireAuth, (req: AuthedRequest, res) => {
    const result = dataStore.sendFriendRequest(req.authUser!.profile.id, String(req.body?.receiverId || ''));
    if (!result.ok) return res.status(400).json({ error: result.error });
    gameManager.notifyUser(String(req.body?.receiverId), { type: 'notifications:refresh' });
    return res.status(201).json(result);
  });

  app.post('/api/friends/requests/:id/respond', requireAuth, (req: AuthedRequest, res) => {
    const result = dataStore.respondFriendRequest(String(req.params.id), req.authUser!.profile.id, Boolean(req.body?.accept));
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  });

  app.delete('/api/friends/:friendId', requireAuth, (req: AuthedRequest, res) => {
    dataStore.removeFriend(req.authUser!.profile.id, String(req.params.friendId));
    res.json({ ok: true });
  });

  app.post('/api/friends/:friendId/invite', requireAuth, (req: AuthedRequest, res) => {
    const friendId = String(req.params.friendId);
    const roomId = String(req.body?.roomId || '');
    const room = gameManager.rooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    dataStore.addNotification(
      friendId,
      'room_invite',
      'Table Invitation',
      `${req.authUser!.profile.username} invited you to join ${room.name} (Code: ${room.code}).`,
      `#join-code:${room.code}`
    );
    gameManager.notifyUser(friendId, { type: 'notifications:refresh' });
    return res.json({ ok: true });
  });

  // CHAT, INBOX & NOTIFICATIONS
  app.post('/api/chat', requireAuth, rateLimit(30, 30_000), (req: AuthedRequest, res) => {
    const { channelType, channelId, recipientId, message, isEmote } = req.body || {};
    const uid = req.authUser!.profile.id;

    if (channelType === 'room') {
      const room = gameManager.rooms.get(String(channelId));
      if (!room) return res.status(404).json({ error: 'Room not found' });
      const seated =
        room.pokerEngine?.seats.some((s) => s.userId === uid) ||
        room.blackjackEngine?.seats.some((s) => s.userId === uid);
      if (!seated && room.hostId !== uid) {
        return res.status(403).json({ error: 'Must be seated in room to send table chat' });
      }
    }

    const result = dataStore.addChatMessage({
      channelType,
      channelId: String(channelId || 'global'),
      senderId: uid,
      recipientId: recipientId ? String(recipientId) : undefined,
      message: String(message || ''),
      isEmote: Boolean(isEmote),
    });
    if (!result.ok) return res.status(400).json({ error: result.error });

    if (channelType === 'room') {
      gameManager.broadcastRoomChat(String(channelId), result.item);
    } else if (channelType === 'direct' && recipientId) {
      gameManager.notifyUser(String(recipientId), { type: 'chat:direct', message: result.item });
    }
    return res.status(201).json(result);
  });

  app.get('/api/inbox', requireAuth, (req: AuthedRequest, res) => {
    const uid = req.authUser!.profile.id;
    const directMessages: unknown[] = [];
    for (const [key, list] of dataStore.chatMessages.entries()) {
      if (key.startsWith('direct:')) {
        for (const msg of list) {
          if (msg.senderId === uid || msg.recipientId === uid) {
            directMessages.push(msg);
          }
        }
      }
    }
    res.json({
      notifications: dataStore.notifications.get(uid) ?? [],
      directMessages,
    });
  });

  app.post('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
    const list = dataStore.notifications.get(req.authUser!.profile.id) ?? [];
    for (const n of list) n.isRead = true;
    res.json({ ok: true });
  });

  // HISTORY & LEADERBOARDS
  app.get('/api/history', requireAuth, (req: AuthedRequest, res) => {
    res.json({
      history: dataStore.gameHistory.get(req.authUser!.profile.id) ?? [],
    });
  });

  app.get('/api/leaderboards', requireAuth, (_req, res) => {
    res.json(dataStore.getLeaderboards());
  });

  // MODERATION (Report / Block / Mute)
  app.post('/api/moderation/report', requireAuth, (req: AuthedRequest, res) => {
    const { reportedUserId, roomId, reason, details } = req.body || {};
    const target = dataStore.users.get(String(reportedUserId || ''));
    if (!target) return res.status(404).json({ error: 'Reported player not found' });
    const report = {
      id: randomUUID(),
      reporterId: req.authUser!.profile.id,
      reporterUsername: req.authUser!.profile.username,
      reportedUserId: target.profile.id,
      reportedUsername: target.profile.username,
      roomId: roomId ? String(roomId) : null,
      reason: String(reason || 'Unsportsmanlike behavior').slice(0, 120),
      details: String(details || '').slice(0, 500),
      status: 'open' as const,
      createdAt: new Date().toISOString(),
    };
    dataStore.reports.unshift(report);
    dataStore.log('warn', 'moderation', `Report filed against ${target.profile.username} by ${req.authUser!.profile.username}`);
    return res.status(201).json({ ok: true, report });
  });

  app.post('/api/moderation/block', requireAuth, (req: AuthedRequest, res) => {
    const targetId = String(req.body?.userId || '');
    if (req.body?.blocked) req.authUser!.blockedUserIds.add(targetId);
    else req.authUser!.blockedUserIds.delete(targetId);
    res.json({ ok: true, blockedUserIds: Array.from(req.authUser!.blockedUserIds) });
  });

  // ADMIN DASHBOARD (Strictly server-enforced role === 'admin')
  app.get('/api/admin/overview', requireAuth, requireAdmin, (_req, res) => {
    const players = Array.from(dataStore.users.values()).map((u) => ({
      id: u.profile.id,
      username: u.profile.username,
      email: u.profile.email,
      role: u.profile.role,
      level: u.profile.level,
      chipBalance: u.wallet.chipBalance,
      isSuspended: u.profile.isSuspended,
      createdAt: u.profile.createdAt,
    }));
    const recentTransactions = Array.from(dataStore.transactions.values())
      .flat()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50);

    res.json({
      players,
      rooms: Array.from(gameManager.rooms.values()).map((r) => gameManager.summarizeRoom(r)),
      tournaments: Array.from(gameManager.tournaments.values()).map((t) => gameManager.summarizeTournament(t)),
      reports: dataStore.reports,
      recentTransactions,
      logs: dataStore.systemLogs.slice(0, 60),
      settings: dataStore.globalSettings,
    });
  });

  app.post('/api/admin/players/:id/suspend', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const target = dataStore.users.get(String(req.params.id));
    if (!target) return res.status(404).json({ error: 'Player not found' });
    if (target.profile.id === req.authUser!.profile.id) {
      return res.status(400).json({ error: 'Cannot suspend your own admin account' });
    }
    target.profile.isSuspended = Boolean(req.body?.suspended);
    dataStore.log('warn', 'admin', `Admin ${req.authUser!.profile.username} ${target.profile.isSuspended ? 'suspended' : 'unsuspended'} ${target.profile.username}`);
    return res.json({ ok: true });
  });

  app.post('/api/admin/reports/:id/resolve', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const rep = dataStore.reports.find((r) => r.id === String(req.params.id));
    if (!rep) return res.status(404).json({ error: 'Report not found' });
    rep.status = req.body?.status === 'dismissed' ? 'dismissed' : 'resolved';
    rep.resolutionNotes = String(req.body?.notes || '');
    return res.json({ ok: true, report: rep });
  });

  app.patch('/api/admin/settings', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const b = req.body || {};
    if (typeof b.maintenanceMode === 'boolean') dataStore.globalSettings.maintenanceMode = b.maintenanceMode;
    if (typeof b.allowNewRegistrations === 'boolean') dataStore.globalSettings.allowNewRegistrations = b.allowNewRegistrations;
    if (b.defaultGameSpeed === 'relaxed' || b.defaultGameSpeed === 'normal' || b.defaultGameSpeed === 'fast') {
      dataStore.globalSettings.defaultGameSpeed = b.defaultGameSpeed;
    }
    if (typeof b.dailyBonusAmount === 'number' && b.dailyBonusAmount >= 100) {
      dataStore.globalSettings.dailyBonusAmount = Math.floor(b.dailyBonusAmount);
    }
    return res.json({ ok: true, settings: dataStore.globalSettings });
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    verifyClient: ({ origin, req }, callback) => {
      // No Origin header: non-browser clients, validated separately by token.
      // Browser origins must be same-origin or explicitly allowlisted.
      if (!origin || allowedOrigins.has(origin)) return callback(true);
      try {
        const parsed = new URL(origin);
        if (parsed.host === req.headers.host) return callback(true);
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
          return callback(true);
        }
      } catch {
        // Invalid origin.
      }
      callback(false, 403, 'Origin not allowed');
    },
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/ws', 'http://localhost');
    const token = url.searchParams.get('token') || '';
    const pendingFrames: string[] = [];
    let meta: ReturnType<typeof gameManager.registerWsClient> | null = null;
    let authedUserId: string | null = null;
    let closed = false;

    const handleFrame = (rawStr: string) => {
      if (!meta || !authedUserId) return;
      try {
        const msg = JSON.parse(rawStr);
        if (msg.type === 'ping') {
          dataStore.onlineUsers.set(authedUserId, {
            ...(dataStore.onlineUsers.get(authedUserId) ?? {}),
            lastPing: Date.now(),
          });
          ws.send(JSON.stringify({ type: 'pong' }));
        } else if (msg.type === 'room:subscribe') {
          gameManager.subscribeClientToRoom(meta, msg.roomId || null);
        } else if (msg.type === 'tournament:subscribe') {
          gameManager.subscribeClientToTournament(meta, msg.tournamentId || null);
        } else if (msg.type === 'poker:action' && meta.roomId) {
          const resAction = gameManager.handlePokerAction(authedUserId, meta.roomId, msg.action, msg.amount, msg.actionId);
          if (!resAction.ok) {
            ws.send(JSON.stringify({ type: 'action:error', error: resAction.error }));
          }
        } else if (msg.type === 'blackjack:action' && meta.roomId) {
          const resAction = gameManager.handleBlackjackAction(authedUserId, meta.roomId, msg.action, msg.amount, msg.actionId);
          if (!resAction.ok) {
            ws.send(JSON.stringify({ type: 'action:error', error: resAction.error }));
          }
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.on('message', (raw) => {
      const str = raw.toString();
      if (!meta) {
        pendingFrames.push(str);
      } else {
        handleFrame(str);
      }
    });

    ws.on('close', () => {
      closed = true;
      if (meta) {
        gameManager.unregisterWsClient(meta);
      }
    });

    void dataStore.authenticateToken(token).then((user) => {
      if (closed) return;
      if (!user) {
        ws.close(4001, 'Unauthorized');
        return;
      }
      authedUserId = user.profile.id;
      meta = gameManager.registerWsClient(ws, user.profile.id);
      ws.send(JSON.stringify({ type: 'ws:connected', userId: user.profile.id }));
      for (const frame of pendingFrames) {
        handleFrame(frame);
      }
      pendingFrames.length = 0;
    });
  });

  return { app, httpServer, dataStore, gameManager };
}

async function bootstrap() {
  const { app, httpServer } = createNeonPokerServer();
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Midnight Poker Club server listening on http://0.0.0.0:${port}`);
  });
}

// Only auto-start server when executed directly (not when imported by Vitest)
const isDirectRun = process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));
if (isDirectRun) {
  void bootstrap();
}
