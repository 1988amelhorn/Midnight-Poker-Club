import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type {
  AchievementBadge,
  ChatMessageItem,
  ChipTransaction,
  FriendItem,
  FriendRequestItem,
  GameHistoryItem,
  GameSpeed,
  LeaderboardEntry,
  ModerationReportItem,
  NotificationItem,
  PlayerStatistics,
  PlayerWallet,
  TransactionType,
  UserProfile,
} from '../src/shared/types.ts';
import {
  createSupabaseUserClient,
  isSupabaseAuthEnabled,
  isSupabaseConfigured,
  supabaseAdmin,
  supabaseAuthVerifier,
} from './supabaseAdmin.ts';

const SESSION_SECRET = process.env.SESSION_SECRET || 'neon-poker-club-dev-secret-change-in-production';

const BAD_WORDS = ['scam', 'cheat', 'rigged', 'spammer', 'fuck', 'shit', 'bitch', 'asshole'];

export function sanitizeChatText(input: string): { clean: string; flagged: boolean } {
  let clean = input.trim().slice(0, 400);
  let flagged = false;
  for (const w of BAD_WORDS) {
    const regex = new RegExp(`\\b${w}\\b`, 'gi');
    if (regex.test(clean)) {
      flagged = true;
      clean = clean.replace(regex, '*'.repeat(w.length));
    }
  }
  return { clean, flagged };
}

export interface StoredUserRecord {
  profile: UserProfile;
  passwordHash: string | null;
  wallet: PlayerWallet;
  stats: PlayerStatistics;
  achievements: AchievementBadge[];
  blockedUserIds: Set<string>;
  mutedUserIds: Set<string>;
}

export interface GlobalSettings {
  maintenanceMode: boolean;
  allowNewRegistrations: boolean;
  defaultGameSpeed: GameSpeed;
  dailyBonusAmount: number;
  welcomeBonusAmount: number;
  maxFriendGiftAmount: number;
}

export interface SystemLogEntry {
  id: string;
  level: 'info' | 'warn' | 'error';
  category: string;
  message: string;
  createdAt: string;
}

export class ServerDataStore {
  public users = new Map<string, StoredUserRecord>();
  public emailToUserId = new Map<string, string>();
  public usernameToUserId = new Map<string, string>();
  public transactions = new Map<string, ChipTransaction[]>();
  public processedIdempotencyKeys = new Set<string>();
  public dailyBonusHistory = new Map<string, Array<{ claimedAt: string; amount: number; streak: number }>>();
  public friendRequests = new Map<string, FriendRequestItem>();
  public friendships = new Set<string>(); // "minId:maxId"
  public chatMessages = new Map<string, ChatMessageItem[]>(); // channelKey -> msgs
  public notifications = new Map<string, NotificationItem[]>();
  public gameHistory = new Map<string, GameHistoryItem[]>();
  public reports: ModerationReportItem[] = [];
  public systemLogs: SystemLogEntry[] = [];
  public onlineUsers = new Map<string, { roomId?: string | null; roomName?: string | null; lastPing: number }>();
  private userAccessTokens = new Map<string, string>();

  public globalSettings: GlobalSettings = {
    maintenanceMode: false,
    allowNewRegistrations: true,
    defaultGameSpeed: 'normal',
    dailyBonusAmount: 2000,
    welcomeBonusAmount: 5000,
    maxFriendGiftAmount: 10000,
  };

  constructor() {
    this.seedInitialPublicLobbyProfiles();
  }

  private seedInitialPublicLobbyProfiles(): void {
    // Only seed an internal system administrator account for verified admin access if needed;
    // never invent fake human players or fake statistics.
    this.log('info', 'startup', `ServerDataStore initialized (mode: ${isSupabaseConfigured ? 'supabase' : 'local-server-authoritative'})`);
  }

  public log(level: 'info' | 'warn' | 'error', category: string, message: string): void {
    this.systemLogs.unshift({
      id: randomUUID(),
      level,
      category,
      message,
      createdAt: new Date().toISOString(),
    });
    if (this.systemLogs.length > 250) this.systemLogs.pop();
  }

  public hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const derived = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derived}`;
  }

  public verifyPassword(password: string, stored: string): boolean {
    const [salt, keyHex] = stored.split(':');
    if (!salt || !keyHex) return false;
    const derived = scryptSync(password, salt, 64);
    const keyBuf = Buffer.from(keyHex, 'hex');
    if (derived.length !== keyBuf.length) return false;
    return timingSafeEqual(derived, keyBuf);
  }

  public signSessionToken(userId: string): string {
    const payload = Buffer.from(
      JSON.stringify({ sub: userId, iat: Date.now(), exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })
    ).toString('base64url');
    const sig = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  public verifyLocalToken(token: string): string | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    const expected = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!parsed.sub || (parsed.exp && Date.now() > parsed.exp)) return null;
      return parsed.sub as string;
    } catch {
      return null;
    }
  }

  private getDbForUser(userId: string) {
    if (isSupabaseConfigured && supabaseAdmin) return supabaseAdmin;
    const tok = this.userAccessTokens.get(userId);
    return tok ? createSupabaseUserClient(tok) : null;
  }

  public async authenticateToken(token: string): Promise<StoredUserRecord | null> {
    if (!token) return null;

    if (isSupabaseAuthEnabled && supabaseAuthVerifier) {
      const { data, error } = await supabaseAuthVerifier.auth.getUser(token);
      if (!error && data.user) {
        this.userAccessTokens.set(data.user.id, token);
        return await this.ensureSupabaseUserSynced(
          data.user.id,
          data.user.email || '',
          data.user.user_metadata,
          token,
          Boolean(data.user.email_confirmed_at)
        );
      }
    }

    const userId = this.verifyLocalToken(token);
    if (!userId) return null;
    return this.users.get(userId) ?? null;
  }

  public async ensureSupabaseUserSynced(
    userId: string,
    email: string,
    metadata?: Record<string, unknown>,
    accessToken?: string,
    emailVerified = true
  ): Promise<StoredUserRecord> {
    if (accessToken) {
      this.userAccessTokens.set(userId, accessToken);
    }

    const db = supabaseAdmin ?? (accessToken ? createSupabaseUserClient(accessToken) : null);

    // Midnight Poker Club's existing Supabase deployment uses the legacy
    // profiles(uid, chips, avatar_url, ...) schema. Unlike the newer schema,
    // its wallet lives in profiles, not player_wallets. Read it as the source
    // of truth for authenticated accounts instead of replacing their real
    // username and chips with a temporary local profile.
    if (isSupabaseAuthEnabled && db) {
      const { data: legacy, error: legacyError } = await db.from('profiles')
        .select('uid,username,avatar_url,chips,total_hands_played,hands_won,tournament_wins,blackjack_wins,lifetime_winnings,created_at')
        .eq('uid', userId).maybeSingle();
      if (!legacyError && legacy) {
        let record = this.users.get(userId);
        if (!record) {
          record = this.createLocalUserRecord({
            id: userId,
            email,
            username: legacy.username,
            password: null,
            avatarId: legacy.avatar_url || 'ace-spade',
            role: 'player',
            emailVerified,
          });
        }
        record.profile.username = legacy.username;
        record.profile.avatarId = legacy.avatar_url || 'ace-spade';
        record.profile.createdAt = legacy.created_at;
        record.profile.emailVerified = emailVerified;
        record.wallet.chipBalance = Number(legacy.chips ?? 0);
        record.wallet.welcomeBonusClaimed = true;
        record.wallet.lifetimeWon = Number(legacy.lifetime_winnings ?? 0);
        record.stats.pokerHandsPlayed = Number(legacy.total_hands_played ?? 0);
        record.stats.pokerHandsWon = Number(legacy.hands_won ?? 0);
        record.stats.tournamentsWon = Number(legacy.tournament_wins ?? 0);
        record.stats.blackjackHandsWon = Number(legacy.blackjack_wins ?? 0);
        record.stats.totalGamesPlayed = record.stats.pokerHandsPlayed;
        this.usernameToUserId.set(legacy.username.toLowerCase(), userId);
        this.emailToUserId.set(email.toLowerCase(), userId);
        return record;
      }
    }

    const existing = this.users.get(userId);
    if (existing) {
      existing.profile.emailVerified = emailVerified;
      return existing;
    }

    if (isSupabaseAuthEnabled && db) {
      let { data: profileRow } = await db
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      let { data: walletRow } = await db
        .from('player_wallets')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      // Auto-create player profile, stats, and 5,000 welcome chips (once) if missing
      if (!profileRow || !walletRow) {
        const desiredName =
          (typeof metadata?.username === 'string' && metadata.username) ||
          (typeof metadata?.full_name === 'string' && metadata.full_name) ||
          (typeof metadata?.name === 'string' && metadata.name) ||
          email.split('@')[0] ||
          `Player_${userId.slice(0, 6)}`;
        const desiredAvatar =
          (typeof metadata?.avatarId === 'string' && metadata.avatarId) || 'ace-spade';

        const rpcRes = await db.rpc('bootstrap_player_profile', {
          p_username: desiredName,
          p_avatar_id: desiredAvatar,
        });

        // Fallback if migration 003 isn't applied yet & service role admin is present
        if (rpcRes.error && supabaseAdmin) {
          const cleanBase = desiredName.replace(/[^a-zA-Z0-9_]/g, '') || `Player_${userId.slice(0, 6)}`;
          const safeName = this.makeUniqueUsername(cleanBase);
          await supabaseAdmin.from('profiles').upsert({
            id: userId,
            username: safeName,
            avatar_id: desiredAvatar,
          });
          await supabaseAdmin.from('player_wallets').upsert({
            user_id: userId,
            chip_balance: 5000,
            welcome_bonus_claimed: true,
            welcome_claimed_at: new Date().toISOString(),
          });
          await supabaseAdmin.from('chip_transactions').upsert(
            {
              user_id: userId,
              amount: 5000,
              balance_after: 5000,
              tx_type: 'welcome_bonus',
              idempotency_key: `welcome:${userId}`,
              description: 'One-time 5,000 virtual chip welcome bonus',
            },
            { onConflict: 'idempotency_key' }
          );
          await supabaseAdmin.from('player_statistics').upsert({ user_id: userId });
        }

        const p2 = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
        const w2 = await db.from('player_wallets').select('*').eq('user_id', userId).maybeSingle();
        profileRow = p2.data;
        walletRow = w2.data;
      }

      const { data: statsRow } = await db
        .from('player_statistics')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      const { data: latestDailyRow } = await db
        .from('daily_bonus_claims')
        .select('claimed_at, streak_count')
        .eq('user_id', userId)
        .order('claimed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: historyRows } = await db
        .from('game_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(40);

      const { data: achRows } = await db
        .from('achievements')
        .select('*')
        .eq('user_id', userId);

      if (profileRow && walletRow) {
        const lastDailyIso = latestDailyRow?.claimed_at ? String(latestDailyRow.claimed_at) : null;
        const nextDailyIso = lastDailyIso
          ? new Date(new Date(lastDailyIso).getTime() + 24 * 60 * 60 * 1000).toISOString()
          : null;

        const record: StoredUserRecord = {
          profile: {
            id: profileRow.id,
            email,
            username: profileRow.username,
            avatarId: profileRow.avatar_id || 'ace-spade',
            bio: profileRow.bio || '',
            role: profileRow.role || 'player',
            level: profileRow.level || 1,
            xp: profileRow.xp || 0,
            isSuspended: Boolean(profileRow.is_suspended),
            emailVerified,
            soundEnabled: profileRow.sound_enabled ?? true,
            musicEnabled: profileRow.music_enabled ?? false,
            sfxVolume: profileRow.sfx_volume ?? 0.75,
            musicVolume: profileRow.music_volume ?? 0.3,
            reducedAnimations: profileRow.reduced_animations ?? false,
            preferredSpeed: profileRow.preferred_speed || 'normal',
            createdAt: profileRow.created_at,
            lastSeenAt: profileRow.last_seen_at,
          },
          passwordHash: null,
          wallet: {
            userId,
            chipBalance: Number(walletRow.chip_balance ?? 5000),
            welcomeBonusClaimed: Boolean(walletRow.welcome_bonus_claimed),
            lastDailyBonusAt: lastDailyIso,
            nextDailyBonusAt: nextDailyIso,
            dailyStreak: Number(latestDailyRow?.streak_count ?? 0),
            lifetimeWon: Number(walletRow.lifetime_won ?? 0),
            lifetimeLost: Number(walletRow.lifetime_lost ?? 0),
          },
          stats: {
            userId,
            pokerHandsPlayed: statsRow?.poker_hands_played ?? 0,
            pokerHandsWon: statsRow?.poker_hands_won ?? 0,
            tournamentsPlayed: statsRow?.tournaments_played ?? 0,
            tournamentsWon: statsRow?.tournaments_won ?? 0,
            blackjackHandsPlayed: statsRow?.blackjack_hands_played ?? 0,
            blackjackHandsWon: statsRow?.blackjack_hands_won ?? 0,
            blackjackBlackjacks: statsRow?.blackjack_blackjacks ?? 0,
            totalGamesPlayed: statsRow?.total_games_played ?? 0,
          },
          achievements: (achRows ?? []).map((a) => ({
            badgeKey: String(a.badge_key),
            title: String(a.title),
            description: String(a.description),
            unlockedAt: String(a.unlocked_at),
          })),
          blockedUserIds: new Set(),
          mutedUserIds: new Set(),
        };
        this.users.set(userId, record);
        this.emailToUserId.set(email.toLowerCase(), userId);
        this.usernameToUserId.set(record.profile.username.toLowerCase(), userId);
        if (historyRows && historyRows.length > 0) {
          this.gameHistory.set(
            userId,
            historyRows.map((h) => ({
              id: String(h.id),
              gameType: h.game_type,
              roomName: String(h.room_name),
              netChips: Number(h.net_chips),
              summary: String(h.summary),
              createdAt: String(h.created_at),
            }))
          );
        }
        return record;
      }
    }

    const baseUsername =
      (typeof metadata?.username === 'string' && metadata.username) ||
      (typeof metadata?.full_name === 'string' && metadata.full_name) ||
      email.split('@')[0]?.replace(/[^a-zA-Z0-9_]/g, '') ||
      `Player_${userId.slice(0, 6)}`;
    return this.createLocalUserRecord({
      id: userId,
      email,
      username: this.makeUniqueUsername(baseUsername),
      password: null,
      avatarId: (typeof metadata?.avatarId === 'string' && metadata.avatarId) || 'ace-spade',
      emailVerified,
    });
  }

  private makeUniqueUsername(base: string): string {
    let candidate = base.slice(0, 18);
    if (candidate.length < 3) candidate = `Player_${randomBytes(2).toString('hex')}`;
    if (!this.usernameToUserId.has(candidate.toLowerCase())) return candidate;
    for (let i = 1; i < 999; i++) {
      const next = `${candidate.slice(0, 14)}_${i}`;
      if (!this.usernameToUserId.has(next.toLowerCase())) return next;
    }
    return `Player_${randomUUID().slice(0, 6)}`;
  }

  public isUsernameAvailable(username: string, excludeUserId?: string): boolean {
    const clean = username.trim().toLowerCase();
    if (clean.length < 3 || clean.length > 24) return false;
    const owner = this.usernameToUserId.get(clean);
    return !owner || owner === excludeUserId;
  }

  public async isUsernameAvailableAsync(username: string, excludeUserId?: string): Promise<boolean> {
    if (!this.isUsernameAvailable(username, excludeUserId)) return false;
    const clean = username.trim();
    if (isSupabaseAuthEnabled && supabaseAuthVerifier) {
      const rpcRes = await supabaseAuthVerifier.rpc('check_username_available', {
        p_username: clean,
        p_exclude_user_id: excludeUserId ?? null,
      });
      if (!rpcRes.error && typeof rpcRes.data === 'boolean') {
        return rpcRes.data;
      }
      if (supabaseAdmin) {
        const q = await supabaseAdmin
          .from('profiles')
          .select('id')
          .ilike('username', clean)
          .limit(1)
          .maybeSingle();
        if (q.data && q.data.id !== excludeUserId) return false;
      }
    }
    return true;
  }

  public registerLocalUser(params: {
    email: string;
    password: string;
    username: string;
    avatarId?: string;
    role?: 'player' | 'admin';
  }): { ok: boolean; user?: StoredUserRecord; token?: string; error?: string } {
    if (!this.globalSettings.allowNewRegistrations) {
      return { ok: false, error: 'Registrations are currently paused by an administrator' };
    }
    const emailNorm = params.email.trim().toLowerCase();
    const usernameClean = params.username.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      return { ok: false, error: 'Please enter a valid email address' };
    }
    if (params.password.length < 6) {
      return { ok: false, error: 'Password must be at least 6 characters' };
    }
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(usernameClean)) {
      return { ok: false, error: 'Username must be 3–24 characters (letters, numbers, underscores)' };
    }
    if (this.emailToUserId.has(emailNorm)) {
      return { ok: false, error: 'An account with this email already exists' };
    }
    if (!this.isUsernameAvailable(usernameClean)) {
      return { ok: false, error: 'That username is already taken' };
    }

    const user = this.createLocalUserRecord({
      id: randomUUID(),
      email: emailNorm,
      username: usernameClean,
      password: params.password,
      avatarId: params.avatarId || 'ace-spade',
      role: params.role || (this.users.size === 0 ? 'admin' : 'player'),
      emailVerified: true,
    });
    const token = this.signSessionToken(user.profile.id);
    return { ok: true, user, token };
  }

  private createLocalUserRecord(params: {
    id: string;
    email: string;
    username: string;
    password: string | null;
    avatarId: string;
    role?: 'player' | 'admin';
    emailVerified?: boolean;
  }): StoredUserRecord {
    const now = new Date().toISOString();
    const welcomeAmount = this.globalSettings.welcomeBonusAmount;
    const record: StoredUserRecord = {
      profile: {
        id: params.id,
        email: params.email,
        username: params.username,
        avatarId: params.avatarId,
        bio: 'Social casino player at Midnight Poker Club.',
        role: params.role ?? 'player',
        level: 1,
        xp: 0,
        isSuspended: false,
        emailVerified: params.emailVerified ?? false,
        soundEnabled: true,
        musicEnabled: false,
        sfxVolume: 0.75,
        musicVolume: 0.3,
        reducedAnimations: false,
        preferredSpeed: 'normal',
        createdAt: now,
        lastSeenAt: now,
      },
      passwordHash: params.password ? this.hashPassword(params.password) : null,
      wallet: {
        userId: params.id,
        chipBalance: welcomeAmount,
        welcomeBonusClaimed: true,
        lastDailyBonusAt: null,
        nextDailyBonusAt: null,
        dailyStreak: 0,
        lifetimeWon: 0,
        lifetimeLost: 0,
      },
      stats: {
        userId: params.id,
        pokerHandsPlayed: 0,
        pokerHandsWon: 0,
        tournamentsPlayed: 0,
        tournamentsWon: 0,
        blackjackHandsPlayed: 0,
        blackjackHandsWon: 0,
        blackjackBlackjacks: 0,
        totalGamesPlayed: 0,
      },
      achievements: [
        {
          badgeKey: 'welcome_member',
          title: 'Midnight Club Member',
          description: 'Joined Midnight Poker Club and claimed 5,000 welcome chips.',
          unlockedAt: now,
        },
      ],
      blockedUserIds: new Set(),
      mutedUserIds: new Set(),
    };

    this.users.set(params.id, record);
    this.emailToUserId.set(params.email.toLowerCase(), params.id);
    this.usernameToUserId.set(params.username.toLowerCase(), params.id);
    this.transactions.set(params.id, [
      {
        id: randomUUID(),
        userId: params.id,
        amount: welcomeAmount,
        balanceAfter: welcomeAmount,
        txType: 'welcome_bonus',
        description: 'One-time 5,000 virtual chip welcome bonus',
        createdAt: now,
      },
    ]);
    this.notifications.set(params.id, [
      {
        id: randomUUID(),
        notifType: 'welcome',
        title: 'Welcome to Midnight Poker Club',
        body: `Your wallet has been credited with ${welcomeAmount.toLocaleString()} virtual chips.`,
        isRead: false,
        createdAt: now,
      },
    ]);
    this.gameHistory.set(params.id, []);
    return record;
  }

  public loginLocalUser(email: string, password: string): { ok: boolean; user?: StoredUserRecord; token?: string; error?: string } {
    const emailNorm = email.trim().toLowerCase();
    const uid = this.emailToUserId.get(emailNorm);
    if (!uid) return { ok: false, error: 'Invalid email or password' };
    const record = this.users.get(uid);
    if (!record || !record.passwordHash) return { ok: false, error: 'Invalid email or password' };
    if (!this.verifyPassword(password, record.passwordHash)) {
      return { ok: false, error: 'Invalid email or password' };
    }
    if (record.profile.isSuspended) {
      return { ok: false, error: 'Account is suspended. Contact support.' };
    }
    record.profile.lastSeenAt = new Date().toISOString();
    const token = this.signSessionToken(uid);
    return { ok: true, user: record, token };
  }

  public deleteUserAccount(userId: string): boolean {
    const rec = this.users.get(userId);
    if (!rec) return false;
    this.emailToUserId.delete(rec.profile.email.toLowerCase());
    this.usernameToUserId.delete(rec.profile.username.toLowerCase());
    this.users.delete(userId);
    this.transactions.delete(userId);
    this.notifications.delete(userId);
    this.gameHistory.delete(userId);
    return true;
  }

  public updateProfile(
    userId: string,
    patch: Partial<Pick<UserProfile, 'username' | 'avatarId' | 'bio' | 'soundEnabled' | 'musicEnabled' | 'sfxVolume' | 'musicVolume' | 'reducedAnimations' | 'preferredSpeed'>>
  ): { ok: boolean; profile?: UserProfile; error?: string } {
    const rec = this.users.get(userId);
    if (!rec) return { ok: false, error: 'User not found' };

    if (patch.username && patch.username.trim() !== rec.profile.username) {
      const clean = patch.username.trim();
      if (!/^[a-zA-Z0-9_]{3,24}$/.test(clean)) {
        return { ok: false, error: 'Username must be 3–24 characters (letters, numbers, underscores)' };
      }
      if (!this.isUsernameAvailable(clean, userId)) {
        return { ok: false, error: 'Username is already taken' };
      }
      this.usernameToUserId.delete(rec.profile.username.toLowerCase());
      this.usernameToUserId.set(clean.toLowerCase(), userId);
      rec.profile.username = clean;
    }

    if (patch.avatarId !== undefined) rec.profile.avatarId = patch.avatarId;
    if (patch.bio !== undefined) rec.profile.bio = patch.bio.slice(0, 180);
    if (patch.soundEnabled !== undefined) rec.profile.soundEnabled = Boolean(patch.soundEnabled);
    if (patch.musicEnabled !== undefined) rec.profile.musicEnabled = Boolean(patch.musicEnabled);
    if (patch.sfxVolume !== undefined) rec.profile.sfxVolume = Math.max(0, Math.min(1, Number(patch.sfxVolume)));
    if (patch.musicVolume !== undefined) rec.profile.musicVolume = Math.max(0, Math.min(1, Number(patch.musicVolume)));
    if (patch.reducedAnimations !== undefined) rec.profile.reducedAnimations = Boolean(patch.reducedAnimations);
    if (patch.preferredSpeed !== undefined) rec.profile.preferredSpeed = patch.preferredSpeed;

    const db = this.getDbForUser(userId);
    if (db) {
      void db
        .from('profiles')
        .update({
          username: rec.profile.username,
          avatar_id: rec.profile.avatarId,
          bio: rec.profile.bio,
          sound_enabled: rec.profile.soundEnabled,
          music_enabled: rec.profile.musicEnabled,
          sfx_volume: rec.profile.sfxVolume,
          music_volume: rec.profile.musicVolume,
          reduced_animations: rec.profile.reducedAnimations,
          preferred_speed: rec.profile.preferredSpeed,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
    }

    return { ok: true, profile: rec.profile };
  }

  // ATOMIC WALLET MUTATION (single point of truth, prevents negative balances & duplicates)
  public mutateChips(params: {
    userId: string;
    delta: number;
    txType: TransactionType;
    description: string;
    referenceId?: string;
    idempotencyKey?: string;
  }): { ok: boolean; newBalance: number; error?: string; duplicate?: boolean } {
    if (params.idempotencyKey) {
      if (this.processedIdempotencyKeys.has(params.idempotencyKey)) {
        const w = this.users.get(params.userId)?.wallet;
        return { ok: true, newBalance: w?.chipBalance ?? 0, duplicate: true };
      }
    }

    const rec = this.users.get(params.userId);
    if (!rec) return { ok: false, newBalance: 0, error: 'Wallet not found' };

    const deltaInt = Math.trunc(params.delta);
    const nextBalance = rec.wallet.chipBalance + deltaInt;
    if (nextBalance < 0) {
      return { ok: false, newBalance: rec.wallet.chipBalance, error: 'Insufficient virtual chips' };
    }

    rec.wallet.chipBalance = nextBalance;
    if (params.txType === 'poker_win' || params.txType === 'blackjack_payout' || params.txType === 'tournament_payout') {
      if (deltaInt > 0) rec.wallet.lifetimeWon += deltaInt;
    }

    if (params.idempotencyKey) {
      this.processedIdempotencyKeys.add(params.idempotencyKey);
    }

    const tx: ChipTransaction = {
      id: randomUUID(),
      userId: params.userId,
      amount: deltaInt,
      balanceAfter: nextBalance,
      txType: params.txType,
      referenceId: params.referenceId,
      description: params.description,
      createdAt: new Date().toISOString(),
    };
    const list = this.transactions.get(params.userId) ?? [];
    list.unshift(tx);
    if (list.length > 200) list.pop();
    this.transactions.set(params.userId, list);

    if (isSupabaseConfigured && supabaseAdmin) {
      void supabaseAdmin
        .from('player_wallets')
        .update({ chip_balance: nextBalance, lifetime_won: rec.wallet.lifetimeWon, updated_at: new Date().toISOString() })
        .eq('user_id', params.userId);
      void supabaseAdmin.from('chip_transactions').insert({
        user_id: params.userId,
        amount: deltaInt,
        balance_after: nextBalance,
        tx_type: params.txType,
        reference_id: params.referenceId ?? null,
        idempotency_key: params.idempotencyKey ?? null,
        description: params.description,
      });
    }

    return { ok: true, newBalance: nextBalance };
  }

  public claimWelcomeBonus(userId: string): { ok: boolean; claimed: boolean; newBalance: number; error?: string } {
    const rec = this.users.get(userId);
    if (!rec) return { ok: false, claimed: false, newBalance: 0, error: 'Account not found' };
    if (rec.wallet.welcomeBonusClaimed) {
      return { ok: false, claimed: false, newBalance: rec.wallet.chipBalance, error: 'Welcome bonus already claimed' };
    }
    rec.wallet.welcomeBonusClaimed = true;
    const res = this.mutateChips({
      userId,
      delta: this.globalSettings.welcomeBonusAmount,
      txType: 'welcome_bonus',
      description: 'One-time welcome virtual chip bonus',
      idempotencyKey: `welcome:${userId}`,
    });
    return { ok: res.ok, claimed: res.ok, newBalance: res.newBalance, error: res.error };
  }

  public claimDailyBonus(userId: string, nowMs = Date.now()): {
    ok: boolean;
    claimed: boolean;
    newBalance: number;
    nextClaimAt: string;
    streak: number;
    error?: string;
  } {
    const rec = this.users.get(userId);
    if (!rec) {
      return { ok: false, claimed: false, newBalance: 0, nextClaimAt: new Date(nowMs).toISOString(), streak: 0, error: 'User not found' };
    }

    const lastAtMs = rec.wallet.lastDailyBonusAt ? new Date(rec.wallet.lastDailyBonusAt).getTime() : 0;
    const ms24h = 24 * 60 * 60 * 1000;
    const ms48h = 48 * 60 * 60 * 1000;

    if (lastAtMs > 0 && nowMs - lastAtMs < ms24h) {
      const nextIso = new Date(lastAtMs + ms24h).toISOString();
      rec.wallet.nextDailyBonusAt = nextIso;
      return {
        ok: false,
        claimed: false,
        newBalance: rec.wallet.chipBalance,
        nextClaimAt: nextIso,
        streak: rec.wallet.dailyStreak,
        error: 'Daily 2,000-chip bonus already claimed in the last 24 hours',
      };
    }

    const nextStreak = lastAtMs > 0 && nowMs - lastAtMs < ms48h ? rec.wallet.dailyStreak + 1 : 1;
    const amount = this.globalSettings.dailyBonusAmount;
    const nowIso = new Date(nowMs).toISOString();
    const nextIso = new Date(nowMs + ms24h).toISOString();

    const dayKey = Math.floor(nowMs / ms24h);
    const res = this.mutateChips({
      userId,
      delta: amount,
      txType: 'daily_bonus',
      description: `Daily ${amount.toLocaleString()}-chip refill (Day ${nextStreak} streak)`,
      idempotencyKey: `daily:${userId}:${dayKey}:${rec.wallet.dailyStreak}`,
    });

    if (!res.ok) {
      return { ok: false, claimed: false, newBalance: rec.wallet.chipBalance, nextClaimAt: nextIso, streak: rec.wallet.dailyStreak, error: res.error };
    }

    rec.wallet.lastDailyBonusAt = nowIso;
    rec.wallet.nextDailyBonusAt = nextIso;
    rec.wallet.dailyStreak = nextStreak;
    const hist = this.dailyBonusHistory.get(userId) ?? [];
    hist.unshift({ claimedAt: nowIso, amount, streak: nextStreak });
    this.dailyBonusHistory.set(userId, hist);

    if (isSupabaseConfigured && supabaseAdmin) {
      void supabaseAdmin.from('daily_bonus_claims').insert({
        user_id: userId,
        amount,
        streak_count: nextStreak,
        claimed_at: nowIso,
      });
    } else {
      const userDb = this.getDbForUser(userId);
      if (userDb) {
        void userDb.rpc('claim_daily_bonus_self');
      }
    }

    return {
      ok: true,
      claimed: true,
      newBalance: res.newBalance,
      nextClaimAt: nextIso,
      streak: nextStreak,
    };
  }

  public transferChipsBetweenFriends(
    senderId: string,
    receiverId: string,
    amount: number,
    idempotencyKey?: string
  ): { ok: boolean; senderBalance: number; error?: string } {
    const cleanAmount = Math.trunc(amount);
    if (cleanAmount <= 0 || cleanAmount > this.globalSettings.maxFriendGiftAmount) {
      return {
        ok: false,
        senderBalance: this.users.get(senderId)?.wallet.chipBalance ?? 0,
        error: `Gift amount must be between 1 and ${this.globalSettings.maxFriendGiftAmount.toLocaleString()} chips`,
      };
    }
    if (senderId === receiverId) {
      return { ok: false, senderBalance: 0, error: 'Cannot send chips to yourself' };
    }
    if (!this.areFriends(senderId, receiverId)) {
      return { ok: false, senderBalance: 0, error: 'You can only send chip gifts to accepted friends' };
    }

    const sender = this.users.get(senderId);
    const receiver = this.users.get(receiverId);
    if (!sender || !receiver) return { ok: false, senderBalance: 0, error: 'Player not found' };

    const key = idempotencyKey || `gift:${senderId}:${receiverId}:${randomUUID()}`;
    if (this.processedIdempotencyKeys.has(key)) {
      return { ok: true, senderBalance: sender.wallet.chipBalance };
    }

    const debit = this.mutateChips({
      userId: senderId,
      delta: -cleanAmount,
      txType: 'friend_gift_sent',
      referenceId: receiverId,
      idempotencyKey: `${key}:debit`,
      description: `Chip gift sent to ${receiver.profile.username}`,
    });
    if (!debit.ok) {
      return { ok: false, senderBalance: sender.wallet.chipBalance, error: debit.error };
    }

    this.mutateChips({
      userId: receiverId,
      delta: cleanAmount,
      txType: 'friend_gift_received',
      referenceId: senderId,
      idempotencyKey: `${key}:credit`,
      description: `Chip gift received from ${sender.profile.username}`,
    });

    this.processedIdempotencyKeys.add(key);
    this.addNotification(
      receiverId,
      'chip_gift',
      'Chip Gift Received',
      `${sender.profile.username} sent you ${cleanAmount.toLocaleString()} virtual chips.`
    );

    return { ok: true, senderBalance: debit.newBalance };
  }

  public addXpAndCheckAchievements(userId: string, xpGain: number): void {
    const rec = this.users.get(userId);
    if (!rec) return;
    rec.profile.xp += xpGain;
    // Every 250 XP levels up
    const newLevel = Math.floor(rec.profile.xp / 250) + 1;
    if (newLevel > rec.profile.level) {
      rec.profile.level = newLevel;
      this.addNotification(userId, 'level_up', `Level ${newLevel} Reached!`, `You advanced to Level ${newLevel} in Midnight Poker Club.`);
    }

    const unlock = (badgeKey: string, title: string, description: string) => {
      if (rec.achievements.some((a) => a.badgeKey === badgeKey)) return;
      rec.achievements.push({ badgeKey, title, description, unlockedAt: new Date().toISOString() });
      this.addNotification(userId, 'achievement', `Badge Unlocked: ${title}`, description);
    };

    if (rec.stats.pokerHandsWon >= 1) unlock('first_poker_win', 'First Pot', 'Won your first Texas Hold\'em hand.');
    if (rec.stats.pokerHandsWon >= 25) unlock('poker_shark', 'Card Shark', 'Won 25 Texas Hold\'em hands.');
    if (rec.stats.blackjackBlackjacks >= 1) unlock('natural_21', 'Natural 21', 'Hit a natural Blackjack.');
    if (rec.stats.tournamentsWon >= 1) unlock('tournament_champ', 'Tournament Champion', 'Won a Midnight Poker Club tournament.');
    if (rec.wallet.chipBalance >= 25000) unlock('high_roller', 'High Roller', 'Accumulated 25,000+ virtual chips.');
  }

  public recordGameHistory(userId: string, item: Omit<GameHistoryItem, 'id' | 'createdAt'>): void {
    const rec = this.users.get(userId);
    if (!rec) return;
    const entry: GameHistoryItem = {
      id: randomUUID(),
      ...item,
      createdAt: new Date().toISOString(),
    };
    const list = this.gameHistory.get(userId) ?? [];
    list.unshift(entry);
    if (list.length > 100) list.pop();
    this.gameHistory.set(userId, list);

    if (item.netChips < 0) {
      rec.wallet.lifetimeLost += Math.abs(item.netChips);
    }

    if (isSupabaseConfigured && supabaseAdmin) {
      void supabaseAdmin.from('game_history').insert({
        user_id: userId,
        game_type: item.gameType,
        room_name: item.roomName,
        net_chips: item.netChips,
        summary: item.summary,
      });
      void supabaseAdmin
        .from('player_statistics')
        .upsert({
          user_id: userId,
          poker_hands_played: rec.stats.pokerHandsPlayed,
          poker_hands_won: rec.stats.pokerHandsWon,
          tournaments_played: rec.stats.tournamentsPlayed,
          tournaments_won: rec.stats.tournamentsWon,
          blackjack_hands_played: rec.stats.blackjackHandsPlayed,
          blackjack_hands_won: rec.stats.blackjackHandsWon,
          blackjack_blackjacks: rec.stats.blackjackBlackjacks,
          total_games_played: rec.stats.totalGamesPlayed,
          updated_at: new Date().toISOString(),
        });
      void supabaseAdmin
        .from('profiles')
        .update({
          xp: rec.profile.xp,
          level: rec.profile.level,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', userId);
      if (item.netChips < 0) {
        void supabaseAdmin
          .from('player_wallets')
          .update({ lifetime_lost: rec.wallet.lifetimeLost, updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      }
    } else {
      const userDb = this.getDbForUser(userId);
      if (userDb) {
        void userDb.rpc('record_my_game_result', {
          p_game_type: item.gameType,
          p_room_name: item.roomName,
          p_net_chips: item.netChips,
          p_summary: item.summary,
          p_hand_won: item.netChips > 0,
          p_is_blackjack: item.summary.toLowerCase().includes('natural blackjack'),
          p_xp_gain: item.netChips > 0 ? 35 : 12,
        });
      }
    }
  }

  public addNotification(userId: string, notifType: string, title: string, body: string, actionUrl?: string): void {
    const list = this.notifications.get(userId) ?? [];
    list.unshift({
      id: randomUUID(),
      notifType,
      title,
      body,
      actionUrl,
      isRead: false,
      createdAt: new Date().toISOString(),
    });
    if (list.length > 80) list.pop();
    this.notifications.set(userId, list);
  }

  private friendshipKey(a: string, b: string): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  public areFriends(a: string, b: string): boolean {
    return this.friendships.has(this.friendshipKey(a, b));
  }

  public sendFriendRequest(senderId: string, receiverId: string): { ok: boolean; request?: FriendRequestItem; error?: string } {
    if (senderId === receiverId) return { ok: false, error: 'Cannot friend yourself' };
    const sender = this.users.get(senderId);
    const receiver = this.users.get(receiverId);
    if (!sender || !receiver) return { ok: false, error: 'Player not found' };
    if (this.areFriends(senderId, receiverId)) return { ok: false, error: 'Already friends' };

    for (const req of this.friendRequests.values()) {
      if (req.status === 'pending' && req.senderId === senderId && req.receiverId === receiverId) {
        return { ok: false, error: 'Friend request already sent' };
      }
    }

    const req: FriendRequestItem = {
      id: randomUUID(),
      senderId,
      senderUsername: sender.profile.username,
      senderAvatarId: sender.profile.avatarId,
      receiverId,
      receiverUsername: receiver.profile.username,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.friendRequests.set(req.id, req);
    this.addNotification(receiverId, 'friend_request', 'New Friend Request', `${sender.profile.username} sent you a friend request.`);
    return { ok: true, request: req };
  }

  public respondFriendRequest(requestId: string, userId: string, accept: boolean): { ok: boolean; error?: string } {
    const req = this.friendRequests.get(requestId);
    if (!req || req.receiverId !== userId || req.status !== 'pending') {
      return { ok: false, error: 'Friend request not found' };
    }
    req.status = accept ? 'accepted' : 'rejected';
    if (accept) {
      this.friendships.add(this.friendshipKey(req.senderId, req.receiverId));
      this.addNotification(req.senderId, 'friend_accepted', 'Friend Request Accepted', `${req.receiverUsername} accepted your friend request.`);
    }
    return { ok: true };
  }

  public removeFriend(userId: string, friendId: string): void {
    this.friendships.delete(this.friendshipKey(userId, friendId));
  }

  public getFriendsList(userId: string): FriendItem[] {
    const friends: FriendItem[] = [];
    for (const key of this.friendships) {
      const [a, b] = key.split(':');
      const otherId = a === userId ? b : b === userId ? a : null;
      if (!otherId) continue;
      const other = this.users.get(otherId);
      if (!other) continue;
      const presence = this.onlineUsers.get(otherId);
      friends.push({
        userId: otherId,
        username: other.profile.username,
        avatarId: other.profile.avatarId,
        level: other.profile.level,
        online: Boolean(presence && Date.now() - presence.lastPing < 60_000),
        currentRoomId: presence?.roomId ?? null,
        currentRoomName: presence?.roomName ?? null,
      });
    }
    return friends;
  }

  public addChatMessage(params: {
    channelType: 'room' | 'tournament' | 'direct' | 'global';
    channelId: string;
    senderId: string;
    recipientId?: string;
    message: string;
    isEmote?: boolean;
  }): { ok: boolean; item?: ChatMessageItem; error?: string } {
    const sender = this.users.get(params.senderId);
    if (!sender) return { ok: false, error: 'User not found' };
    if (sender.profile.isSuspended) return { ok: false, error: 'Account is suspended' };

    const { clean } = sanitizeChatText(params.message);
    if (!clean) return { ok: false, error: 'Message cannot be empty' };

    const item: ChatMessageItem = {
      id: randomUUID(),
      channelType: params.channelType,
      channelId: params.channelId,
      senderId: params.senderId,
      senderUsername: sender.profile.username,
      senderAvatarId: sender.profile.avatarId,
      recipientId: params.recipientId,
      message: clean,
      isEmote: Boolean(params.isEmote),
      createdAt: new Date().toISOString(),
    };
    const key = `${params.channelType}:${params.channelId}`;
    const list = this.chatMessages.get(key) ?? [];
    list.push(item);
    if (list.length > 100) list.shift();
    this.chatMessages.set(key, list);
    return { ok: true, item };
  }

  public getLeaderboards(): {
    handsWon: LeaderboardEntry[];
    tournamentsWon: LeaderboardEntry[];
    chipBalances: LeaderboardEntry[];
    winPercentage: LeaderboardEntry[];
    blackjackWins: LeaderboardEntry[];
    playerLevels: LeaderboardEntry[];
  } {
    const all = Array.from(this.users.values()).filter((u) => !u.profile.isSuspended);

    const toEntry = (u: StoredUserRecord, rank: number, value: number, secondaryLabel: string): LeaderboardEntry => ({
      rank,
      userId: u.profile.id,
      username: u.profile.username,
      avatarId: u.profile.avatarId,
      level: u.profile.level,
      value,
      secondaryLabel,
    });

    const handsWon = [...all]
      .sort((a, b) => b.stats.pokerHandsWon - a.stats.pokerHandsWon)
      .slice(0, 25)
      .map((u, i) => toEntry(u, i + 1, u.stats.pokerHandsWon, `${u.stats.pokerHandsPlayed} hands`));

    const tournamentsWon = [...all]
      .sort((a, b) => b.stats.tournamentsWon - a.stats.tournamentsWon)
      .slice(0, 25)
      .map((u, i) => toEntry(u, i + 1, u.stats.tournamentsWon, `${u.stats.tournamentsPlayed} played`));

    const chipBalances = [...all]
      .sort((a, b) => b.wallet.chipBalance - a.wallet.chipBalance)
      .slice(0, 25)
      .map((u, i) => toEntry(u, i + 1, u.wallet.chipBalance, 'virtual chips'));

    // Minimum-game threshold (at least 5 hands played) for meaningful win percentage
    const winPercentage = [...all]
      .filter((u) => u.stats.pokerHandsPlayed >= 5)
      .sort((a, b) => {
        const rateA = a.stats.pokerHandsWon / a.stats.pokerHandsPlayed;
        const rateB = b.stats.pokerHandsWon / b.stats.pokerHandsPlayed;
        return rateB - rateA;
      })
      .slice(0, 25)
      .map((u, i) => {
        const pct = Math.round((u.stats.pokerHandsWon / u.stats.pokerHandsPlayed) * 100);
        return toEntry(u, i + 1, pct, `${u.stats.pokerHandsWon}/${u.stats.pokerHandsPlayed} hands`);
      });

    const blackjackWins = [...all]
      .sort((a, b) => b.stats.blackjackHandsWon - a.stats.blackjackHandsWon)
      .slice(0, 25)
      .map((u, i) => toEntry(u, i + 1, u.stats.blackjackHandsWon, `${u.stats.blackjackBlackjacks} blackjacks`));

    const playerLevels = [...all]
      .sort((a, b) => (b.profile.level !== a.profile.level ? b.profile.level - a.profile.level : b.profile.xp - a.profile.xp))
      .slice(0, 25)
      .map((u, i) => toEntry(u, i + 1, u.profile.level, `${u.profile.xp} XP`));

    return { handsWon, tournamentsWon, chipBalances, winPercentage, blackjackWins, playerLevels };
  }
}
