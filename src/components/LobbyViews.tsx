import React, { useEffect, useState } from 'react';
import {
  Bot,
  ChevronLeft,
  Coins,
  Copy,
  Gift,
  Heart,
  Lock,
  Minus,
  Play,
  Plus,
  Shield,
  Spade,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useGameSocket } from '../context/GameSocketContext.tsx';
import type { BotDifficulty, GameRoomSummary, GameSpeed, GameType, RoomVisibility } from '../shared/types.ts';
import { PlayerAvatar } from '../utils/avatars.tsx';

export type AppScreen =
  | 'lobby'
  | 'holdem_browser'
  | 'blackjack_browser'
  | 'create_private'
  | 'join_private'
  | 'room_waiting'
  | 'live_poker'
  | 'live_blackjack'
  | 'create_tournament'
  | 'tournament_browser'
  | 'tournament_detail'
  | 'profile'
  | 'friends'
  | 'inbox'
  | 'leaderboards'
  | 'history'
  | 'wallet'
  | 'daily_bonus'
  | 'daily_wheel'
  | 'settings'
  | 'admin'
  | 'owner';

export const MainLobbyView: React.FC<{
  onNavigate: (screen: AppScreen, param?: string) => void;
  pendingFriendRequests?: number;
  isOwner?: boolean;
}> = ({ onNavigate, pendingFriendRequests = 0, isOwner = false }) => {
  const { user, wallet, activeRoom, stats } = useAuth();
  const { lobbyRooms, lobbyTournaments, refreshLobby } = useGameSocket();

  useEffect(() => {
    void refreshLobby();
  }, [refreshLobby]);

  const holdemCount = lobbyRooms.filter((r) => r.gameType === 'holdem').length;
  const bjCount = lobbyRooms.filter((r) => r.gameType === 'blackjack').length;
  const tournCount = lobbyTournaments.filter((t) => t.status !== 'completed').length;

  return (
    <div className="casino-screen max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Resume Active Table Banner */}
      {activeRoom && (
        <div className="rounded-[26px] border-2 border-emerald-400/55 bg-gradient-to-r from-emerald-950/60 via-[#0d1d33]/90 to-cyan-950/50 backdrop-blur-md px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[0_0_28px_rgba(16,185,129,0.2)]">
          <div>
            <p className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">Active Seat Found</p>
            <p className="text-sm font-display font-bold text-white">
              You are seated in {activeRoom.name} ({activeRoom.code})
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate(activeRoom.gameType === 'blackjack' ? 'live_blackjack' : 'live_poker', activeRoom.id)}
            className="inline-flex items-center justify-center gap-2 rounded-full btn-glossy btn-glossy-green px-6 py-2.5 text-xs font-display font-extrabold text-slate-950"
          >
            <Play className="w-4 h-4 fill-current" /> Resume Table
          </button>
        </div>
      )}

      {/* Verified owner shortcut is intentionally ABOVE the hero: on mobile it
          must not be hidden below the long lobby tiles and daily bonuses. */}
      {isOwner && (
        <button type="button" onClick={() => onNavigate('owner')}
          className="neon-casino-panel glass-bubbly rounded-[25px] p-3.5 sm:p-4 w-full flex items-center justify-between gap-3 text-left border-2 border-amber-400/60 shadow-[0_0_22px_rgba(251,191,36,0.18)]">
          <span className="flex items-center gap-3">
            <Shield className="w-7 h-7 text-amber-300 shrink-0"/>
            <span>
              <span className="block font-display font-extrabold text-white text-sm">Owner Dashboard</span>
              <span className="block text-xs text-slate-300">See signups, games &amp; online players</span>
            </span>
          </span>
          <span className="btn-glossy btn-glossy-gold rounded-full px-4 py-2 text-slate-950 font-bold text-xs">Open</span>
        </button>
      )}

      {/* Midnight Skyline Hero Banner */}
      <div className="neon-casino-panel relative rounded-[26px] overflow-hidden border border-cyan-400/35 shadow-[0_0_24px_rgba(34,211,238,0.12)] min-h-[160px] sm:min-h-[210px] flex flex-col items-center justify-center text-center p-6">
        <img
          src="/src/assets/images/neon_hero_skyline_1795020140555.jpg"
          alt="Midnight Poker Club Skyline"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover opacity-65"
        />
        <div className="pointer-events-none absolute inset-x-8 top-0 h-20 rounded-full bg-cyan-400/15 blur-2xl" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#060914] via-[#060914]/45 to-[#060914]/35" />

        <div className="relative z-10 space-y-2">
          <h1 className="text-4xl sm:text-5xl font-display font-extrabold tracking-tight bg-gradient-to-r from-cyan-300 via-sky-400 to-purple-400 bg-clip-text text-transparent drop-shadow-[0_0_26px_rgba(34,211,238,0.65)]">
            MIDNIGHT
          </h1>
          <p className="text-base sm:text-lg font-display font-bold tracking-[0.28em] text-amber-300 uppercase drop-shadow-[0_0_12px_rgba(250,204,21,0.5)]">
            POKER CLUB
          </p>
          <p className="text-xs sm:text-sm font-display font-semibold text-cyan-100/95 tracking-wide">
            Where Legends Go All In.
          </p>
          <div className="flex items-center justify-center gap-4 text-2xl pt-1" aria-hidden="true">
            <span className="text-sky-400 drop-shadow-[0_0_10px_rgba(56,189,248,0.9)]">♠</span>
            <span className="text-rose-400 drop-shadow-[0_0_10px_rgba(244,63,94,0.9)]">♥</span>
            <span className="text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.9)]">♣</span>
            <span className="text-fuchsia-400 drop-shadow-[0_0_10px_rgba(232,121,249,0.9)]">♦</span>
          </div>
        </div>
      </div>

      {/* Primary 2x2 Neon Bubbly Mode Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => onNavigate('holdem_browser')}
          className="group relative rounded-2xl border border-purple-400/40 bg-gradient-to-b from-purple-900/65 via-[#140e31]/90 to-[#0a0f22] p-3.5 sm:p-5 text-center shadow-sm hover:border-purple-300 transition-colors"
        >
          <div className="w-11 h-11 sm:w-14 sm:h-14 mx-auto mb-2 rounded-xl bg-purple-500/20 border border-purple-400/45 flex items-center justify-center shadow-[0_0_18px_rgba(168,85,247,0.4)]">
            <Spade className="w-6 h-6 sm:w-8 sm:h-8 text-purple-200" />
          </div>
          <h2 className="text-sm sm:text-base font-display font-extrabold text-white tracking-wide">TEXAS HOLD&apos;EM</h2>
          <p className="text-xs text-purple-200/85 mt-0.5">Play Poker · {holdemCount} Tables</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('blackjack_browser')}
          className="group relative rounded-2xl border border-rose-400/40 bg-gradient-to-b from-rose-900/65 via-[#2a0f20]/90 to-[#0a0f22] p-3.5 sm:p-5 text-center shadow-sm hover:border-rose-300 transition-colors"
        >
          <div className="w-11 h-11 sm:w-14 sm:h-14 mx-auto mb-2 rounded-xl bg-rose-500/20 border border-rose-400/45 flex items-center justify-center shadow-[0_0_18px_rgba(244,63,94,0.4)]">
            <Heart className="w-6 h-6 sm:w-8 sm:h-8 text-rose-200" />
          </div>
          <h2 className="text-sm sm:text-base font-display font-extrabold text-white tracking-wide">BLACKJACK</h2>
          <p className="text-xs text-rose-200/85 mt-0.5">Play 21 · {bjCount} Tables</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('create_private')}
          className="group relative rounded-2xl border border-sky-400/40 bg-gradient-to-b from-sky-900/65 via-[#0d1f3a]/90 to-[#0a0f22] p-3.5 sm:p-5 text-center shadow-sm hover:border-sky-300 transition-colors"
        >
          <div className="w-11 h-11 sm:w-14 sm:h-14 mx-auto mb-2 rounded-xl bg-sky-500/20 border border-sky-400/45 flex items-center justify-center shadow-[0_0_18px_rgba(56,189,248,0.4)]">
            <Users className="w-6 h-6 sm:w-8 sm:h-8 text-sky-200" />
          </div>
          <h2 className="text-sm sm:text-base font-display font-extrabold text-white tracking-wide">PRIVATE TABLE</h2>
          <p className="text-xs text-sky-200/85 mt-0.5">Friends &amp; Bots with Code</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('tournament_browser')}
          className="group relative rounded-2xl border border-amber-400/40 bg-gradient-to-b from-amber-900/60 via-[#291b0c]/90 to-[#0a0f22] p-3.5 sm:p-5 text-center shadow-sm hover:border-amber-300 transition-colors"
        >
          <div className="w-11 h-11 sm:w-14 sm:h-14 mx-auto mb-2 rounded-xl bg-amber-500/20 border border-amber-400/45 flex items-center justify-center shadow-[0_0_18px_rgba(245,158,11,0.4)]">
            <Trophy className="w-6 h-6 sm:w-8 sm:h-8 text-amber-200" />
          </div>
          <h2 className="text-sm sm:text-base font-display font-extrabold text-white tracking-wide">TOURNAMENT</h2>
          <p className="text-xs text-amber-200/85 mt-0.5">Create · Join by Code · {tournCount} Live</p>
        </button>
      </div>

      {/* Compact club dashboard: features remain one tap away, without oversized cards. */}
      <section className="space-y-3" aria-label="Club dashboard">
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => onNavigate('daily_bonus')}
            className="flex items-center gap-2.5 rounded-2xl border border-amber-400/25 bg-[#11172e] p-3 text-left hover:border-amber-400/55 transition-colors min-w-0">
            <span className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-amber-400/10 text-amber-300"><Gift className="w-5 h-5" /></span>
            <span className="min-w-0">
              <span className="block text-xs sm:text-sm font-bold text-white">Daily Bonus</span>
              <span className="block text-[11px] text-amber-200">Claim 2,000 chips</span>
            </span>
          </button>
          <button type="button" onClick={() => onNavigate('daily_wheel')}
            className="flex items-center gap-2.5 rounded-2xl border border-fuchsia-400/25 bg-[#11172e] p-3 text-left hover:border-fuchsia-400/55 transition-colors min-w-0">
            <span className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-fuchsia-400/10 text-fuchsia-300"><Trophy className="w-5 h-5" /></span>
            <span className="min-w-0">
              <span className="block text-xs sm:text-sm font-bold text-white">Prize Wheel</span>
              <span className="block text-[11px] text-fuchsia-200">Free daily spin</span>
            </span>
          </button>
        </div>
        <div className="rounded-2xl border border-slate-700/60 bg-[#0d1529]/90 px-3.5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Coins className="w-5 h-5 text-amber-300 shrink-0" />
            <span className="text-xs text-slate-300">Wallet</span>
            <span className="font-mono font-bold text-sm text-amber-200 tabular-nums">{(wallet?.chipBalance ?? 0).toLocaleString()}</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => onNavigate('wallet')}
              className="rounded-full border border-slate-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">Wallet</button>
            <button type="button" onClick={() => onNavigate('leaderboards')}
              className="rounded-full border border-cyan-500/40 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-950/50">
              Rankings
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-[11px] text-slate-500">{stats?.pokerHandsWon ?? 0} Hold’em wins · {stats?.blackjackHandsWon ?? 0} Blackjack wins</p>
          <button type="button" onClick={() => onNavigate('friends')}
            className="inline-flex items-center gap-2 text-xs font-semibold text-cyan-200 hover:text-white">
            <Users className="w-4 h-4" /> Friends
            {pendingFriendRequests > 0 && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-extrabold text-white">{pendingFriendRequests > 99 ? '99+' : pendingFriendRequests} new</span>}
          </button>
        </div>
      </section>

      {/* Browse tables in Games rather than duplicating the full table list on Home. */}
      <button type="button" onClick={() => onNavigate('holdem_browser')}
        className="w-full rounded-2xl border border-slate-700/55 bg-[#0d1529]/80 px-4 py-3 flex items-center justify-between gap-3 text-left hover:border-cyan-400/50 transition-colors">
        <span className="inline-flex items-center gap-2.5 text-sm font-semibold text-white"><Spade className="w-4 h-4 text-cyan-300" /> Browse Public Tables</span>
        <span className="text-xs text-cyan-300">View Games →</span>
      </button>
    </div>
  );
};

export const RoomBrowserView: React.FC<{
  gameType: GameType;
  onEnterRoom: (room: GameRoomSummary) => void;
  onCreateRoom: () => void;
  onBack: () => void;
}> = ({ gameType, onEnterRoom, onCreateRoom, onBack }) => {
  const { wallet, refreshWallet } = useAuth();
  const { lobbyRooms, refreshLobby } = useGameSocket();
  const [selectedBuyin, setSelectedBuyin] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    void refreshLobby();
  }, [refreshLobby]);

  const rooms = lobbyRooms.filter((r) => r.gameType === gameType);

  const handleJoin = async (room: GameRoomSummary) => {
    setError(null);
    setJoiningId(room.id);
    try {
      const buyin = selectedBuyin[room.id] ?? Math.min(room.maxBuyin, Math.max(room.minBuyin, 1000));
      const res = await apiFetch<{ room: GameRoomSummary }>('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ roomIdOrCode: room.id, buyinAmount: buyin }),
      });
      await refreshWallet();
      onEnterRoom(res.room);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to join room');
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <button type="button" onClick={onBack} className="w-9 h-9 sm:w-10 sm:h-10 rounded-full btn-glossy btn-glossy-dark flex items-center justify-center text-slate-200 shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl font-display font-bold text-white truncate">
              {gameType === 'holdem' ? "Texas Hold'em Tables" : 'Blackjack Tables'}
            </h1>
            <p className="text-xs text-slate-400 truncate">
              Wallet: <span className="font-mono text-amber-300">{(wallet?.chipBalance ?? 0).toLocaleString()}</span> virtual chips
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCreateRoom}
          className="inline-flex items-center gap-1.5 rounded-full btn-glossy btn-glossy-purple px-3.5 py-2 sm:px-5 sm:py-2.5 text-[11px] sm:text-xs font-display font-bold text-white whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" /> Create Table
        </button>
      </div>

      {error && <div className="rounded-2xl bg-rose-500/15 border border-rose-500/40 px-4 py-2.5 text-xs text-rose-300">{error}</div>}

      <div className="space-y-3.5">
        {rooms.map((room) => {
          const buyinVal = selectedBuyin[room.id] ?? Math.min(room.maxBuyin, Math.max(room.minBuyin, 1000));
          const botCount = room.players.filter((p) => p.isBot).length;
          return (
            <div key={room.id} className="neon-casino-panel rounded-[26px] glass-bubbly p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-display font-bold text-white">{room.name}</h2>
                  <span className="font-mono text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-400/30 rounded-full px-2.5 py-0.5">{room.code}</span>
                  {botCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 border border-purple-400/40 px-2 py-0.5 text-[10px] font-bold text-purple-200">
                      <Bot className="w-3 h-3" /> {botCount} BOT{botCount > 1 ? 'S' : ''}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1 font-mono tabular-nums">
                  {room.playerCount}/{room.maxPlayers} players ·{' '}
                  {gameType === 'holdem' ? `Blinds ${room.smallBlind}/${room.bigBlind}` : `Bets ${room.smallBlind}–${room.bigBlind}`} ·{' '}
                  Buy-in {room.minBuyin}–{room.maxBuyin}
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <input
                  type="number"
                  min={room.minBuyin}
                  max={room.maxBuyin}
                  step={50}
                  value={buyinVal}
                  onChange={(e) => setSelectedBuyin((p) => ({ ...p, [room.id]: Number(e.target.value) }))}
                  className="w-24 rounded-2xl input-bubbly px-3 py-2 text-xs font-mono text-white"
                />
                <button
                  type="button"
                  disabled={joiningId === room.id || room.playerCount >= room.maxPlayers}
                  onClick={() => void handleJoin(room)}
                  className="px-5 py-2.5 rounded-full btn-glossy btn-glossy-green text-slate-950 font-display font-extrabold text-xs disabled:opacity-40"
                >
                  {joiningId === room.id ? 'Joining...' : 'Join Seat'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const CreatePrivateRoomView: React.FC<{
  onCreated: (room: GameRoomSummary) => void;
  onJoinExisting: () => void;
  onBack: () => void;
}> = ({ onCreated, onJoinExisting, onBack }) => {
  const { refreshWallet } = useAuth();
  const [gameType, setGameType] = useState<GameType>('holdem');
  const [name, setName] = useState('Friends Table');
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [visibility, setVisibility] = useState<RoomVisibility>('private');
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [smallBlind, setSmallBlind] = useState(25);
  const [minBuyin, setMinBuyin] = useState(500);
  const [maxBuyin, setMaxBuyin] = useState(5000);
  const [gameSpeed, setGameSpeed] = useState<GameSpeed>('normal');
  const [initialBots, setInitialBots] = useState(0);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>('normal');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedTables, setSavedTables] = useState<Array<{
    id: string; name: string; game_type: GameType;
    max_players: number; min_buyin: number; created_at: string;
  }>>([]);
  const [reopening, setReopening] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void apiFetch<{ tables: typeof savedTables }>('/api/clubs/presets')
      .then((result) => { if (alive) setSavedTables(result.tables || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const reopenSavedTable = async (id: string) => {
    setError(null);
    setReopening(id);
    try {
      const result = await apiFetch<{ room: GameRoomSummary }>(
        `/api/clubs/presets/${encodeURIComponent(id)}/reopen`, { method: 'POST' }
      );
      await refreshWallet();
      onCreated(result.room);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reopen table');
    } finally {
      setReopening(null);
    }
  };

  const maxAllowedBots = Math.max(0, maxPlayers - 1);
  const clampedBots = gameType === 'holdem' ? Math.min(initialBots, maxAllowedBots) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const effectiveMax = gameType === 'blackjack' ? Math.min(7, maxPlayers) : maxPlayers;
      const res = await apiFetch<{ room: GameRoomSummary }>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name,
          gameType,
          maxPlayers: effectiveMax,
          visibility,
          password: usePassword && password ? password : undefined,
          smallBlind,
          bigBlind: gameType === 'blackjack' ? 1000 : smallBlind * 2,
          minBuyin,
          maxBuyin,
          buyinAmount: minBuyin,
          gameSpeed,
          initialBots: clampedBots,
          botDifficulty,
        }),
      });
      await refreshWallet();
      onCreated(res.room);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create table');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <button type="button" onClick={onBack} className="w-9 h-9 sm:w-10 sm:h-10 rounded-full btn-glossy btn-glossy-dark flex items-center justify-center text-slate-200 shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg sm:text-xl font-display font-bold text-white truncate">Create Private Table</h1>
        </div>
        <button type="button" onClick={onJoinExisting} className="text-xs font-semibold text-cyan-300 hover:underline whitespace-nowrap shrink-0">
          Have a code? Join
        </button>
      </div>

      {savedTables.length > 0 && (
        <section className="neon-casino-panel glass-bubbly rounded-[26px] p-4 space-y-3">
          <h2 className="font-display font-bold text-sm text-amber-300">Your Saved Club Tables</h2>
          <p className="text-xs text-slate-400">Reopen a familiar table with its previous blinds and seat limits. A fresh game starts.</p>
          {savedTables.map((item) => (
            <div key={item.id} className="input-bubbly rounded-2xl p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white font-bold text-sm truncate">{item.name}</p>
                <p className="text-xs text-slate-400">{item.game_type === 'holdem' ? 'Poker' : 'Blackjack'} · {item.max_players} seats</p>
              </div>
              <button type="button" disabled={reopening !== null}
                onClick={() => void reopenSavedTable(item.id)}
                className="btn-glossy btn-glossy-blue text-white font-bold text-xs rounded-full px-4 py-2 shrink-0 disabled:opacity-60">
                {reopening === item.id ? 'Opening…' : 'Reopen'}
              </button>
            </div>
          ))}
        </section>
      )}

      {error && <div className="rounded-2xl bg-rose-500/15 border border-rose-500/40 px-4 py-2.5 text-xs text-rose-300">{error}</div>}

      <form onSubmit={handleSubmit} className="rounded-[30px] glass-bubbly p-5 sm:p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Game Type</label>
          <div className="grid grid-cols-2 gap-2 p-1.5 rounded-full bg-slate-950/80 border border-slate-700/70">
            <button
              type="button"
              onClick={() => setGameType('holdem')}
              className={`py-2.5 rounded-full text-xs font-display font-bold transition ${
                gameType === 'holdem' ? 'btn-glossy btn-glossy-purple text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Texas Hold&apos;em
            </button>
            <button
              type="button"
              onClick={() => setGameType('blackjack')}
              className={`py-2.5 rounded-full text-xs font-display font-bold transition ${
                gameType === 'blackjack' ? 'btn-glossy btn-glossy-pink text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Blackjack
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Table Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-2xl input-bubbly px-4 py-2.5 text-sm text-white"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Max Players</label>
          <div className="grid grid-cols-4 gap-2">
            {(gameType === 'blackjack' ? [2, 4, 6, 7] : [2, 4, 6, 9]).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setMaxPlayers(n);
                  setInitialBots((prev) => Math.min(prev, n - 1));
                }}
                className={`py-2.5 rounded-full text-xs font-bold transition ${
                  maxPlayers === n
                    ? 'btn-glossy btn-glossy-purple text-white'
                    : 'btn-glossy btn-glossy-dark text-slate-300'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Optional Poker Bots Setup */}
        {gameType === 'holdem' && (
          <div className="rounded-3xl border border-cyan-400/35 bg-gradient-to-br from-cyan-950/35 via-[#0e1730]/80 to-purple-950/35 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-slate-950 shadow-[0_0_16px_rgba(34,211,238,0.45)]">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-display font-bold text-white flex items-center gap-2">
                    Poker Bots
                    <span className="rounded-full bg-cyan-400/20 border border-cyan-300/50 px-2 py-0.5 text-[10px] font-mono text-cyan-200">
                      {clampedBots}/{maxAllowedBots}
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-400">Fair AI · No hidden-card peeking</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {clampedBots > 0 && (
                  <button
                    type="button"
                    onClick={() => setInitialBots((b) => Math.max(0, b - 1))}
                    aria-label="Remove one bot"
                    className="w-9 h-9 rounded-full btn-glossy btn-glossy-dark flex items-center justify-center text-slate-200"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  disabled={clampedBots >= maxAllowedBots}
                  onClick={() => setInitialBots((b) => Math.min(maxAllowedBots, b + 1))}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full btn-glossy btn-glossy-blue text-white font-display font-bold text-xs disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Bot
                </button>
              </div>
            </div>

            {clampedBots > 0 && (
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-cyan-500/20">
                <span className="text-[11px] font-semibold text-slate-300">Default Bot Difficulty</span>
                <div className="flex items-center gap-1">
                  {(['easy', 'normal', 'hard'] as BotDifficulty[]).map((diff) => (
                    <button
                      key={diff}
                      type="button"
                      onClick={() => setBotDifficulty(diff)}
                      className={`px-3 py-1 rounded-full text-[11px] font-bold capitalize transition ${
                        botDifficulty === diff
                          ? 'bg-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.5)]'
                          : 'bg-slate-900/90 border border-slate-700 text-slate-300'
                      }`}
                    >
                      {diff}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              {gameType === 'holdem' ? 'Starting Blinds' : 'Minimum Bet'}
            </label>
            <select
              value={smallBlind}
              onChange={(e) => setSmallBlind(Number(e.target.value))}
              className="w-full rounded-2xl input-bubbly px-3.5 py-2.5 text-sm text-white"
            >
              <option value={10}>{gameType === 'holdem' ? '10 / 20' : '10'}</option>
              <option value={25}>{gameType === 'holdem' ? '25 / 50' : '25'}</option>
              <option value={50}>{gameType === 'holdem' ? '50 / 100' : '50'}</option>
              <option value={100}>{gameType === 'holdem' ? '100 / 200' : '100'}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Visibility</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as RoomVisibility)}
              className="w-full rounded-2xl input-bubbly px-3.5 py-2.5 text-sm text-white"
            >
              <option value="private">Private (Code)</option>
              <option value="public">Public</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Min Buy-In</label>
            <input
              type="number"
              min={100}
              value={minBuyin}
              onChange={(e) => setMinBuyin(Number(e.target.value))}
              className="w-full rounded-2xl input-bubbly px-3.5 py-2.5 text-sm font-mono text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Max Buy-In</label>
            <input
              type="number"
              min={minBuyin}
              value={maxBuyin}
              onChange={(e) => setMaxBuyin(Number(e.target.value))}
              className="w-full rounded-2xl input-bubbly px-3.5 py-2.5 text-sm font-mono text-white"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Game Speed</label>
          <div className="grid grid-cols-3 gap-2">
            {(['relaxed', 'normal', 'fast'] as GameSpeed[]).map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => setGameSpeed(sp)}
                className={`py-2 rounded-full text-xs font-semibold capitalize transition ${
                  gameSpeed === sp
                    ? 'btn-glossy btn-glossy-blue text-white'
                    : 'btn-glossy btn-glossy-dark text-slate-300'
                }`}
              >
                {sp}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between p-3.5 rounded-2xl input-bubbly cursor-pointer">
          <span className="text-xs font-medium text-slate-200 flex items-center gap-2">
            <Lock className="w-4 h-4 text-slate-400" /> Password (Optional)
          </span>
          <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} className="accent-purple-500 w-4 h-4" />
        </label>

        {usePassword && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter table password"
            className="w-full rounded-2xl input-bubbly px-4 py-2.5 text-sm text-white"
          />
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3.5 rounded-full btn-glossy btn-glossy-purple text-white font-display font-extrabold text-sm"
        >
          {submitting ? 'Creating Table...' : 'Create Table'}
        </button>
      </form>
    </div>
  );
};

export const JoinPrivateRoomView: React.FC<{
  prefillCode?: string;
  onJoined: (room: GameRoomSummary) => void;
  onBack: () => void;
}> = ({ prefillCode = '', onJoined, onBack }) => {
  const { refreshWallet } = useAuth();
  const { lobbyRooms } = useGameSocket();
  const [code, setCode] = useState(prefillCode);
  const [password, setPassword] = useState('');
  const [buyinAmount, setBuyinAmount] = useState(500);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ room: GameRoomSummary }>('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({
          roomIdOrCode: code.trim().toUpperCase(),
          password: password || undefined,
          buyinAmount,
        }),
      });
      await refreshWallet();
      onJoined(res.room);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to join room');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="w-10 h-10 rounded-full btn-glossy btn-glossy-dark flex items-center justify-center text-slate-200">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-display font-bold text-white">Join Private Table</h1>
      </div>

      {error && <div className="rounded-2xl bg-rose-500/15 border border-rose-500/40 px-4 py-2.5 text-xs text-rose-300">{error}</div>}

      <form onSubmit={handleJoin} className="rounded-[30px] glass-bubbly p-5 sm:p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Enter 6-Character Invitation Code</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="ABC123"
            required
            className="w-full rounded-2xl input-bubbly px-4 py-3 text-center font-mono text-lg font-bold tracking-[0.3em] uppercase text-cyan-300"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Password (If Required)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-2xl input-bubbly px-3.5 py-2.5 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Table Buy-In</label>
            <input
              type="number"
              min={100}
              step={50}
              value={buyinAmount}
              onChange={(e) => setBuyinAmount(Number(e.target.value))}
              className="w-full rounded-2xl input-bubbly px-3.5 py-2.5 text-sm font-mono text-white"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3.5 rounded-full btn-glossy btn-glossy-blue text-white font-display font-extrabold text-sm"
        >
          {submitting ? 'Joining...' : 'Join Table'}
        </button>
      </form>

      {lobbyRooms.length > 0 && (
        <div className="neon-casino-panel rounded-[26px] glass-bubbly p-4 space-y-2.5">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Open Public Tables</h2>
          {lobbyRooms.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setCode(r.code)}
              className="w-full flex items-center justify-between rounded-2xl input-bubbly px-4 py-3 hover:border-cyan-400/60 transition"
            >
              <div className="text-left">
                <p className="text-sm font-semibold text-white">{r.name}</p>
                <p className="font-mono text-xs text-cyan-300">{r.code}</p>
              </div>
              <span className="font-mono text-xs text-slate-400">
                {r.playerCount}/{r.maxPlayers}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const RoomWaitingLobbyView: React.FC<{
  roomId: string;
  onStartToTable: (room: GameRoomSummary) => void;
  onLeave: () => void;
}> = ({ roomId, onStartToTable, onLeave }) => {
  const { user, refreshWallet } = useAuth();
  const { currentRoom, subscribeRoom } = useGameSocket();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyBot, setBusyBot] = useState(false);
  const [savingClub, setSavingClub] = useState(false);
  const [clubSaved, setClubSaved] = useState(false);

  useEffect(() => {
    subscribeRoom(roomId);
    return () => subscribeRoom(null);
  }, [roomId, subscribeRoom]);

  useEffect(() => {
    if (currentRoom?.status === 'active') {
      onStartToTable(currentRoom);
    }
  }, [currentRoom, onStartToTable]);

  if (!currentRoom) {
    return <div className="p-8 text-center text-sm text-slate-400">Loading waiting room...</div>;
  }

  const isHost = currentRoom.hostId === user?.id;
  const canStart = currentRoom.gameType === 'blackjack' ? currentRoom.playerCount >= 1 : currentRoom.playerCount >= 2;
  const hasEmptySeat = currentRoom.playerCount < currentRoom.maxPlayers;

  const handleAddBot = async () => {
    setError(null);
    setBusyBot(true);
    try {
      await apiFetch(`/api/rooms/${roomId}/bots`, {
        method: 'POST',
        body: JSON.stringify({ difficulty: 'normal' }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add bot');
    } finally {
      setBusyBot(false);
    }
  };

  const handleRemoveBot = async (botUserId: string) => {
    setError(null);
    try {
      await apiFetch(`/api/rooms/${roomId}/bots/${botUserId}`, { method: 'DELETE' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove bot');
    }
  };

  const handleDifficultyChange = async (botUserId: string, difficulty: BotDifficulty) => {
    setError(null);
    try {
      await apiFetch(`/api/rooms/${roomId}/bots/${botUserId}/difficulty`, {
        method: 'PATCH',
        body: JSON.stringify({ difficulty }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to change bot difficulty');
    }
  };

  const saveClubTable = async () => {
    setSavingClub(true);
    setError(null);
    try {
      await apiFetch('/api/clubs/presets', { method: 'POST', body: JSON.stringify({ roomId }) });
      setClubSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save table');
    } finally {
      setSavingClub(false);
    }
  };

  const handleStart = async () => {
    setError(null);
    try {
      await apiFetch(`/api/rooms/${roomId}/start`, { method: 'POST' });
      onStartToTable(currentRoom);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start');
    }
  };

  const handleLeave = async () => {
    await apiFetch(`/api/rooms/${roomId}/leave`, { method: 'POST' });
    await refreshWallet();
    onLeave();
  };

  return (
    <div className="max-w-xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <button type="button" onClick={handleLeave} className="w-9 h-9 sm:w-10 sm:h-10 rounded-full btn-glossy btn-glossy-dark flex items-center justify-center text-slate-200 shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl font-display font-bold text-white truncate">{currentRoom.name}</h1>
            <p className="text-xs text-slate-400">
              Table Code:{' '}
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(currentRoom.code);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
                className="font-mono font-bold text-cyan-300 inline-flex items-center gap-1"
              >
                {copied ? 'COPIED' : currentRoom.code} <Copy className="w-3 h-3" />
              </button>
            </p>
          </div>
        </div>

        {isHost && currentRoom.gameType === 'holdem' && hasEmptySeat && (
          <button
            type="button"
            disabled={busyBot}
            onClick={() => void handleAddBot()}
            className="inline-flex items-center gap-1.5 rounded-full btn-glossy btn-glossy-blue px-3.5 py-2 text-xs font-display font-bold text-white whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Add Bot
          </button>
        )}
      </div>

      {error && <div className="rounded-2xl bg-rose-500/15 border border-rose-500/40 px-4 py-2.5 text-xs text-rose-300">{error}</div>}

      <div className="rounded-[30px] glass-bubbly p-5 space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-display font-bold text-white">
            Players ({currentRoom.playerCount}/{currentRoom.maxPlayers})
          </h2>
          {currentRoom.players.some((p) => p.isBot) && (
            <span className="text-[11px] font-mono text-cyan-300">
              Mixed Human + Bot Table
            </span>
          )}
        </div>

        <div className="space-y-2">
          {currentRoom.players.map((p) => (
            <div key={p.userId} className="flex items-center justify-between gap-2 rounded-2xl input-bubbly px-3.5 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <PlayerAvatar avatarId={p.avatarId} username={p.username} size="sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold text-white truncate">
                      {p.username} {p.userId === user?.id && '(You)'} {p.isHost && '👑'}
                    </span>
                    {p.isBot && (
                      <span className="rounded-full bg-gradient-to-r from-cyan-400 to-purple-500 px-2 py-0.5 text-[9px] font-display font-extrabold text-slate-950 tracking-wider shadow-[0_0_10px_rgba(34,211,238,0.5)]">
                        BOT
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {p.isBot && isHost && (
                  <select
                    aria-label={`Difficulty for ${p.username}`}
                    value={p.botDifficulty || 'normal'}
                    onChange={(e) => void handleDifficultyChange(p.userId, e.target.value as BotDifficulty)}
                    className="rounded-full bg-slate-900 border border-cyan-400/40 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 capitalize"
                  >
                    <option value="easy">Easy</option>
                    <option value="normal">Normal</option>
                    <option value="hard">Hard</option>
                  </select>
                )}
                <span className="font-mono text-xs font-bold text-amber-300 tabular-nums">{p.chips.toLocaleString()}</span>
                {p.isBot && isHost && (
                  <button
                    type="button"
                    onClick={() => void handleRemoveBot(p.userId)}
                    title={`Remove ${p.username}`}
                    className="w-6 h-6 rounded-full bg-rose-500/20 border border-rose-400/40 text-rose-300 flex items-center justify-center hover:bg-rose-500/35"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}

          {Array.from({ length: Math.max(0, currentRoom.maxPlayers - currentRoom.playerCount) }).map((_, i) => (
            <div key={i} className="flex items-center justify-between rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/30 px-3.5 py-2.5 text-xs text-slate-500">
              <span>Empty seat — waiting for player...</span>
              {isHost && currentRoom.gameType === 'holdem' && (
                <button
                  type="button"
                  disabled={busyBot}
                  onClick={() => void handleAddBot()}
                  className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 border border-cyan-400/40 px-2.5 py-1 text-[11px] font-bold text-cyan-200 hover:bg-cyan-500/25"
                >
                  <Plus className="w-3 h-3" /> Add Bot
                </button>
              )}
            </div>
          ))}
        </div>

        {isHost && !currentRoom.tournamentId && (
          <div className="pt-2">
            <button type="button" onClick={() => void saveClubTable()} disabled={savingClub || clubSaved}
              className="btn-glossy btn-glossy-purple px-5 py-2.5 rounded-full w-full text-sm font-bold text-white disabled:opacity-65">
              {clubSaved ? '✓ Saved to My Club Tables' : savingClub ? 'Saving…' : 'Save Table for Future Game Nights'}
            </button>
            <p className="text-xs text-slate-400 mt-2 text-center">Save this table's setup so you can reopen it later. Finished hands are not saved yet.</p>
          </div>
        )}
        <div className="pt-2 flex gap-2.5">
          <button
            type="button"
            onClick={handleLeave}
            className="px-4 py-3 rounded-full btn-glossy btn-glossy-dark text-xs font-semibold text-slate-200"
          >
            Leave &amp; Cash Out
          </button>
          {isHost ? (
            <button
              type="button"
              disabled={!canStart}
              onClick={handleStart}
              className="flex-1 py-3 rounded-full btn-glossy btn-glossy-green text-slate-950 font-display font-extrabold text-sm disabled:opacity-40"
            >
              {canStart ? 'Start Game' : "Need 2+ Players (or Add Bot)"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onStartToTable(currentRoom)}
              className="flex-1 py-3 rounded-full btn-glossy btn-glossy-blue text-white font-display font-bold text-sm"
            >
              Enter Table View
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
