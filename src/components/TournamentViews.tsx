import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  Bot,
  ChevronLeft,
  Clock,
  Copy,
  Minus,
  Plus,
  Search,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useGameSocket } from '../context/GameSocketContext.tsx';
import type { BotDifficulty, GameSpeed, RoomVisibility, TournamentSummary } from '../shared/types.ts';
import { PlayerAvatar } from '../utils/avatars.tsx';
import { soundEngine } from '../utils/soundEngine.ts';

export const TournamentBrowserView: React.FC<{
  onCreateTournament: () => void;
  onOpenTournament: (tournamentId: string) => void;
  onJoinRoom: (roomId: string) => void;
  onBack: () => void;
}> = ({ onCreateTournament, onOpenTournament, onJoinRoom, onBack }) => {
  const { lobbyTournaments, refreshLobby } = useGameSocket();
  const [search, setSearch] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshLobby();
  }, [refreshLobby]);

  const filtered = lobbyTournaments.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.code.toLowerCase().includes(search.toLowerCase())
  );

  const handleJoinCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiFetch<{ tournament: TournamentSummary }>('/api/tournaments/join', {
        method: 'POST',
        body: JSON.stringify({ idOrCode: joinCode.trim() }),
      });
      if (res.tournament.roomId && res.tournament.status === 'in_progress') {
        onJoinRoom(res.tournament.roomId);
      } else {
        onOpenTournament(res.tournament.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to join tournament');
    }
  };

  return (
    <div className="casino-screen max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={onBack}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full btn-glossy btn-glossy-dark flex items-center justify-center text-slate-200 shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-2xl font-display font-bold text-white truncate">Tournaments</h1>
            <p className="text-[11px] sm:text-xs text-slate-400 leading-snug line-clamp-2">
              Midnight Poker Club · Sit &amp; Go Hold&apos;em (2–9 players)
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCreateTournament}
          className="inline-flex items-center justify-center gap-1.5 rounded-full btn-glossy btn-glossy-green px-3.5 py-2 sm:px-5 sm:py-2.5 text-[11px] sm:text-sm font-display font-extrabold text-slate-950 whitespace-nowrap shrink-0 max-w-full"
        >
          <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
          <span>Create Tournament</span>
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <form onSubmit={handleJoinCode} className="flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="Join with 6-char code (e.g. KR7P9Q)"
            className="flex-1 rounded-full input-bubbly px-4 py-2.5 text-sm font-mono uppercase text-white"
          />
          <button
            type="submit"
            className="rounded-full btn-glossy btn-glossy-blue px-5 py-2.5 text-xs font-bold text-white whitespace-nowrap"
          >
            Join Code
          </button>
        </form>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tournaments..."
            className="w-full rounded-full input-bubbly pl-10 pr-4 py-2.5 text-sm text-white"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[30px] glass-bubbly p-10 text-center space-y-3">
          <Trophy className="w-11 h-11 text-amber-400 mx-auto drop-shadow-[0_0_16px_rgba(250,204,21,0.5)]" />
          <h2 className="text-base font-display font-bold text-white">No Active Tournaments Yet</h2>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Create a single-table Hold&apos;em tournament with friends or optional poker bots and compete for the trophy.
          </p>
          <button
            type="button"
            onClick={onCreateTournament}
            className="inline-flex items-center gap-2 rounded-full btn-glossy btn-glossy-gold px-6 py-2.5 text-xs font-display font-extrabold text-slate-950"
          >
            <Plus className="w-4 h-4" /> Create First Tournament
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filtered.map((t) => {
            const botCount = t.players.filter((p) => p.isBot).length;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onOpenTournament(t.id)}
                className="text-left rounded-[26px] glass-bubbly hover:border-amber-400/65 p-4 transition flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-300 shrink-0 shadow-[0_0_16px_rgba(245,158,11,0.3)]">
                    <Trophy className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-display font-bold text-white truncate">{t.name}</h3>
                      {botCount > 0 && (
                        <span className="rounded-full bg-purple-500/25 border border-purple-400/40 px-1.5 py-0.5 text-[9px] font-bold text-purple-200 shrink-0">
                          {botCount} BOT{botCount > 1 ? 'S' : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                      {t.registeredCount}/{t.maxPlayers} players · {t.startingChips.toLocaleString()} chips · {t.startingSb}/{t.startingBb}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-xs font-semibold capitalize ${
                    t.status === 'registering'
                      ? 'text-cyan-300'
                      : t.status === 'in_progress'
                        ? 'text-emerald-400'
                        : 'text-amber-300'
                  }`}>
                    {t.status.replace('_', ' ')}
                  </span>
                  <p className="font-mono text-[11px] text-slate-400 mt-0.5">{t.code}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const CreateTournamentView: React.FC<{
  onCreated: (tournamentId: string) => void;
  onBack: () => void;
}> = ({ onCreated, onBack }) => {
  const { refreshWallet } = useAuth();
  const [name, setName] = useState('Friday Night Poker');
  const [startingChips, setStartingChips] = useState(5000);
  const [blindIntervalMinutes, setBlindIntervalMinutes] = useState(10);
  const [startingSb, setStartingSb] = useState(25);
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [anteEnabled, setAnteEnabled] = useState(false);
  const [entryFee, setEntryFee] = useState(0);
  const [visibility, setVisibility] = useState<RoomVisibility>('public');
  const [allowProbabilityAssist, setAllowProbabilityAssist] = useState(true);
  const [gameSpeed, setGameSpeed] = useState<GameSpeed>('normal');
  const [initialBots, setInitialBots] = useState(0);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>('normal');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxAllowedBots = Math.max(0, maxPlayers - 1);
  const clampedBots = Math.min(initialBots, maxAllowedBots);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ tournament: TournamentSummary }>('/api/tournaments', {
        method: 'POST',
        body: JSON.stringify({
          name,
          startingChips,
          blindIntervalMinutes,
          startingSb,
          startingBb: startingSb * 2,
          maxPlayers,
          anteEnabled,
          entryFee,
          visibility,
          allowProbabilityAssist,
          gameSpeed,
          initialBots: clampedBots,
          botDifficulty,
        }),
      });
      await refreshWallet();
      onCreated(res.tournament.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tournament');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="w-10 h-10 rounded-full btn-glossy btn-glossy-dark flex items-center justify-center text-slate-200"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-display font-bold text-white">Create Tournament</h1>
          <p className="text-xs text-slate-400">Single-table No-Limit Texas Hold&apos;em tournament (2–9 seats)</p>
        </div>
      </div>

      {error && <div className="rounded-2xl bg-rose-500/15 border border-rose-500/40 px-4 py-2.5 text-xs text-rose-300">{error}</div>}

      <form onSubmit={handleSubmit} className="rounded-[30px] glass-bubbly p-5 sm:p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Tournament Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-2xl input-bubbly px-4 py-2.5 text-sm text-white"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Starting Chips</label>
            <select
              value={startingChips}
              onChange={(e) => setStartingChips(Number(e.target.value))}
              className="w-full rounded-2xl input-bubbly px-3.5 py-2.5 text-sm text-white"
            >
              <option value={2000}>2,000</option>
              <option value={5000}>5,000 (Default)</option>
              <option value={10000}>10,000</option>
              <option value={25000}>25,000</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Blind Levels (Minutes)</label>
            <select
              value={blindIntervalMinutes}
              onChange={(e) => setBlindIntervalMinutes(Number(e.target.value))}
              className="w-full rounded-2xl input-bubbly px-3.5 py-2.5 text-sm text-white"
            >
              <option value={3}>3 minutes</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes (Default)</option>
              <option value={15}>15 minutes</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Starting Blinds</label>
            <select
              value={startingSb}
              onChange={(e) => setStartingSb(Number(e.target.value))}
              className="w-full rounded-2xl input-bubbly px-3.5 py-2.5 text-sm text-white"
            >
              <option value={10}>10 / 20</option>
              <option value={25}>25 / 50 (Default)</option>
              <option value={50}>50 / 100</option>
              <option value={100}>100 / 200</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Max Players (Single Table)</label>
            <select
              value={maxPlayers}
              onChange={(e) => {
                const nextMax = Number(e.target.value);
                setMaxPlayers(nextMax);
                setInitialBots((b) => Math.min(b, nextMax - 1));
              }}
              className="w-full rounded-2xl input-bubbly px-3.5 py-2.5 text-sm text-white"
            >
              <option value={2}>2 Players (Heads-Up)</option>
              <option value={4}>4 Players</option>
              <option value={6}>6 Players</option>
              <option value={8}>8 Players (Default)</option>
              <option value={9}>9 Players</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Virtual Chip Entry Fee</label>
            <select
              value={entryFee}
              onChange={(e) => setEntryFee(Number(e.target.value))}
              className="w-full rounded-2xl input-bubbly px-3.5 py-2.5 text-sm text-white"
            >
              <option value={0}>Free Roll (0 chips)</option>
              <option value={100}>100 chips</option>
              <option value={500}>500 chips</option>
              <option value={1000}>1,000 chips</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Visibility</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as RoomVisibility)}
              className="w-full rounded-2xl input-bubbly px-3.5 py-2.5 text-sm text-white"
            >
              <option value="public">Public Tournament</option>
              <option value="private">Private (Code Only)</option>
            </select>
          </div>
        </div>

        {/* Optional Tournament Bots Setup */}
        <div className="rounded-3xl border border-cyan-400/35 bg-gradient-to-br from-cyan-950/35 via-[#0e1730]/80 to-purple-950/35 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-slate-950 shadow-[0_0_16px_rgba(34,211,238,0.45)]">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-display font-bold text-white flex items-center gap-2">
                  Tournament Bots
                  <span className="rounded-full bg-cyan-400/20 border border-cyan-300/50 px-2 py-0.5 text-[10px] font-mono text-cyan-200">
                    {clampedBots}/{maxAllowedBots}
                  </span>
                </p>
                <p className="text-[11px] text-slate-400">Fill empty tournament seats with fair AI competitors</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {clampedBots > 0 && (
                <button
                  type="button"
                  onClick={() => setInitialBots((b) => Math.max(0, b - 1))}
                  aria-label="Remove one tournament bot"
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

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Default Game Speed</label>
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

        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          <label className="flex-1 flex items-center justify-between p-3.5 rounded-2xl input-bubbly cursor-pointer">
            <span className="text-xs font-medium text-slate-200">Enable Antes</span>
            <input type="checkbox" checked={anteEnabled} onChange={(e) => setAnteEnabled(e.target.checked)} className="accent-emerald-500 w-4 h-4" />
          </label>
          <label className="flex-1 flex items-center justify-between p-3.5 rounded-2xl input-bubbly cursor-pointer">
            <span className="text-xs font-medium text-slate-200">Allow Hand Odds Assist</span>
            <input type="checkbox" checked={allowProbabilityAssist} onChange={(e) => setAllowProbabilityAssist(e.target.checked)} className="accent-emerald-500 w-4 h-4" />
          </label>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3.5 rounded-full btn-glossy btn-glossy-green text-slate-950 font-display font-extrabold text-sm disabled:opacity-50"
        >
          {submitting ? 'Creating...' : 'Create Tournament'}
        </button>
      </form>
    </div>
  );
};

export const TournamentDetailView: React.FC<{
  tournamentId: string;
  initialTab?: 'lobby' | 'info' | 'standings' | 'winner';
  onEnterTable: (roomId: string) => void;
  onPlayAnother: () => void;
  onBack: () => void;
}> = ({ tournamentId, initialTab = 'lobby', onEnterTable, onPlayAnother, onBack }) => {
  const { user, refreshWallet } = useAuth();
  const { currentTournament, subscribeTournament } = useGameSocket();
  const [tab, setTab] = useState<'lobby' | 'info' | 'standings' | 'winner'>(initialTab);
  const [nowMs, setNowMs] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyBot, setBusyBot] = useState(false);

  useEffect(() => {
    subscribeTournament(tournamentId);
    return () => subscribeTournament(null);
  }, [tournamentId, subscribeTournament]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (currentTournament?.status === 'completed') {
      setTab('winner');
      if (soundEngine.shouldPlayOnce(`tourn-win:${currentTournament.id}`)) {
        soundEngine.playTournamentWin();
        void confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 } });
      }
    }
  }, [currentTournament?.status, currentTournament?.id]);

  const t = currentTournament;
  if (!t || t.id !== tournamentId) {
    return (
      <div className="max-w-3xl mx-auto p-6 text-center text-sm text-slate-400">
        Loading tournament...
      </div>
    );
  }

  const isCreator = t.creatorId === user?.id;
  const isRegistered = t.players.some((p) => p.userId === user?.id);
  const currentLvl = t.blindSchedule[t.currentLevel - 1] ?? t.blindSchedule[0];
  const nextLvl = t.blindSchedule[t.currentLevel] ?? null;

  const remainingMs = t.levelEndsAt ? Math.max(0, new Date(t.levelEndsAt).getTime() - nowMs) : t.blindIntervalMinutes * 60_000;
  const mins = Math.floor(remainingMs / 60_000);
  const secs = Math.floor((remainingMs % 60_000) / 1000);
  const timerStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const progressPct = Math.min(100, Math.max(0, (remainingMs / (t.blindIntervalMinutes * 60_000)) * 100));

  const totalChipsInPlay = t.players.reduce((acc, p) => acc + p.tournamentChips, 0);
  const winnerPlayer = t.players.find((p) => p.userId === t.winnerId) || t.players[0];

  const handleJoin = async () => {
    setError(null);
    try {
      await apiFetch('/api/tournaments/join', {
        method: 'POST',
        body: JSON.stringify({ idOrCode: t.id }),
      });
      await refreshWallet();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to register');
    }
  };

  const handleLeave = async () => {
    setError(null);
    try {
      await apiFetch(`/api/tournaments/${t.id}/leave`, { method: 'POST' });
      await refreshWallet();
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to leave');
    }
  };

  const handleAddBot = async () => {
    setError(null);
    setBusyBot(true);
    try {
      await apiFetch(`/api/tournaments/${t.id}/bots`, {
        method: 'POST',
        body: JSON.stringify({ difficulty: 'normal' }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add bot');
    } finally {
      setBusyBot(false);
    }
  };

  const handleRemoveBot = async (botId: string) => {
    setError(null);
    try {
      await apiFetch(`/api/tournaments/${t.id}/bots/${botId}`, { method: 'DELETE' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove bot');
    }
  };

  const handleStart = async () => {
    setError(null);
    try {
      const res = await apiFetch<{ tournament: TournamentSummary }>(`/api/tournaments/${t.id}/start`, {
        method: 'POST',
      });
      if (res.tournament.roomId) {
        onEnterTable(res.tournament.roomId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={onBack}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full btn-glossy btn-glossy-dark flex items-center justify-center text-slate-200 shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl font-display font-bold text-white truncate">{t.name}</h1>
            <p className="text-[11px] sm:text-xs text-slate-400 truncate">
              Code <span className="font-mono text-cyan-300">{t.code}</span> · {t.registeredCount}/{t.maxPlayers} Players · {t.status.replace('_', ' ')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {t.status === 'in_progress' && t.roomId && isRegistered && (
            <button
              type="button"
              onClick={() => onEnterTable(t.roomId!)}
              className="rounded-full btn-glossy btn-glossy-green px-5 py-2 text-xs font-display font-extrabold text-slate-950"
            >
              Open Live Table
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(t.code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
            className="inline-flex items-center gap-1.5 rounded-full btn-glossy btn-glossy-dark px-3.5 py-2 text-xs font-mono text-cyan-300"
          >
            {copied ? 'Copied!' : t.code} <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1.5 rounded-full glass-bubbly overflow-x-auto">
        {[
          { id: 'lobby', label: 'Waiting Room' },
          { id: 'info', label: 'Tournament Info & Timer' },
          { id: 'standings', label: 'Standings' },
          ...(t.status === 'completed' ? [{ id: 'winner', label: 'Winner Celebration' }] : []),
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id as typeof tab)}
            className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition ${
              tab === item.id ? 'btn-glossy btn-glossy-blue text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-2xl bg-rose-500/15 border border-rose-500/40 px-4 py-2.5 text-xs text-rose-300">{error}</div>}

      {/* Tab: Waiting Room */}
      {tab === 'lobby' && (
        <div className="rounded-[30px] glass-bubbly p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-700/70 pb-4">
            <div>
              <p className="text-xs text-slate-400">Share this code with your friends:</p>
              <p className="text-2xl font-mono font-extrabold tracking-widest text-cyan-300 mt-0.5">{t.code}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {t.status === 'registering' && !isRegistered && (
                <button
                  type="button"
                  onClick={handleJoin}
                  className="px-5 py-2.5 rounded-full btn-glossy btn-glossy-blue text-white font-display font-bold text-xs"
                >
                  Register ({t.entryFee > 0 ? `${t.entryFee} chips` : 'Free'})
                </button>
              )}
              {t.status === 'registering' && isRegistered && !isCreator && (
                <button
                  type="button"
                  onClick={handleLeave}
                  className="px-4 py-2.5 rounded-full btn-glossy btn-glossy-pink text-white text-xs font-semibold"
                >
                  Unregister
                </button>
              )}
              {t.status === 'registering' && isCreator && t.registeredCount < t.maxPlayers && (
                <button
                  type="button"
                  disabled={busyBot}
                  onClick={() => void handleAddBot()}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full btn-glossy btn-glossy-blue text-white font-display font-bold text-xs disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Bot
                </button>
              )}
              {t.status === 'registering' && isCreator && (
                <button
                  type="button"
                  disabled={t.registeredCount < 2}
                  onClick={handleStart}
                  className="px-5 py-2.5 rounded-full btn-glossy btn-glossy-green text-slate-950 font-display font-extrabold text-xs disabled:opacity-40"
                >
                  Start Tournament ({t.registeredCount}/{t.maxPlayers})
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Registered Players ({t.registeredCount}/{t.maxPlayers})
            </h3>
            {t.players.map((p) => (
              <div key={p.userId} className="flex items-center justify-between gap-2 rounded-2xl input-bubbly px-4 py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <PlayerAvatar avatarId={p.avatarId} username={p.username} size="sm" />
                  <span className="text-sm font-semibold text-white truncate">
                    {p.username} {p.userId === t.creatorId && '👑'} {p.userId === user?.id && '(You)'}
                  </span>
                  {p.isBot && (
                    <span className="rounded-full bg-gradient-to-r from-cyan-400 to-purple-500 px-2 py-0.5 text-[9px] font-display font-extrabold text-slate-950 tracking-wider shadow-[0_0_10px_rgba(34,211,238,0.5)]">
                      BOT · {(p.botDifficulty || 'normal').toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-xs font-bold text-amber-300">{p.tournamentChips.toLocaleString()} chips</span>
                  {p.isBot && isCreator && t.status === 'registering' && (
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
            {Array.from({ length: Math.max(0, t.maxPlayers - t.registeredCount) }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/25 px-4 py-2.5 text-xs text-slate-500">
                <span className="inline-flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  <span>Waiting for player...</span>
                </span>
                {t.status === 'registering' && isCreator && (
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
        </div>
      )}

      {/* Tab: Tournament Info & Blind Timer (matches Reference Image 2 #6 & #8) */}
      {tab === 'info' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-[28px] glass-bubbly p-5 space-y-3">
            <h2 className="text-base font-display font-bold text-white">Tournament Details</h2>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between py-1.5 border-b border-slate-800/70">
                <span className="text-slate-400">Starting Chips</span>
                <span className="font-mono font-bold text-white tabular-nums">{t.startingChips.toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/70">
                <span className="text-slate-400">Current Blinds</span>
                <span className="font-mono font-bold text-emerald-400 tabular-nums">
                  {currentLvl.smallBlind} / {currentLvl.bigBlind}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/70">
                <span className="text-slate-400">Next Level</span>
                <span className="font-mono text-white tabular-nums">
                  {nextLvl ? `${timerStr} (${nextLvl.smallBlind}/${nextLvl.bigBlind})` : 'Max Level'}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/70">
                <span className="text-slate-400">Level Duration</span>
                <span className="font-mono text-white">{t.blindIntervalMinutes} minutes</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/70">
                <span className="text-slate-400">Players Remaining</span>
                <span className="font-mono text-white tabular-nums">
                  {t.players.filter((p) => p.status !== 'eliminated').length} / {t.registeredCount}
                </span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400">Total Tournament Chips</span>
                <span className="font-mono text-amber-300 font-bold tabular-nums">{totalChipsInPlay.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] glass-bubbly p-5 flex flex-col items-center space-y-4">
            <h2 className="text-base font-display font-bold text-white self-start flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-400" /> Blind Timer
            </h2>

            {/* SVG Circular Progress Ring */}
            <div className="relative w-36 h-36 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" stroke="#1e293b" strokeWidth="8" fill="none" />
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  stroke="#10b981"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={326.7}
                  strokeDashoffset={326.7 - (326.7 * progressPct) / 100}
                />
              </svg>
              <div className="absolute text-center">
                <p className="font-mono text-2xl font-extrabold text-white tabular-nums">{timerStr}</p>
                <p className="text-[11px] text-slate-400">Level {t.currentLevel}</p>
              </div>
            </div>

            <div className="w-full space-y-1.5">
              <p className="text-xs font-semibold text-slate-400">Blind Schedule</p>
              <div className="max-h-44 overflow-y-auto space-y-1">
                {t.blindSchedule.map((lvl) => (
                  <div
                    key={lvl.level}
                    className={`flex items-center justify-between px-3 py-1.5 rounded-xl text-xs font-mono ${
                      lvl.level === t.currentLevel
                        ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 font-bold'
                        : 'bg-slate-900/60 text-slate-400'
                    }`}
                  >
                    <span>Level {lvl.level}</span>
                    <span>
                      {lvl.smallBlind} / {lvl.bigBlind}
                      {lvl.ante > 0 ? ` (Ante ${lvl.ante})` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Standings (matches Reference Image 2 #7) */}
      {tab === 'standings' && (
        <div className="rounded-[28px] glass-bubbly overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-base font-display font-bold text-white">
              Players ({t.registeredCount} / {t.maxPlayers})
            </h2>
            <span className="text-xs text-slate-400 font-mono">{t.totalHandsPlayed} hands played</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-900/90 text-slate-400 font-semibold">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Player</th>
                  <th className="px-4 py-3">Chips</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {t.players.map((p, idx) => (
                  <tr key={p.userId} className={p.userId === user?.id ? 'bg-emerald-500/10' : ''}>
                    <td className="px-4 py-3 font-mono text-slate-400">{p.placement ?? idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <PlayerAvatar avatarId={p.avatarId} username={p.username} size="xs" />
                        <span className="font-semibold text-white">
                          {p.username} {p.userId === user?.id && '(You)'}
                        </span>
                        {p.isBot && (
                          <span className="rounded-full bg-gradient-to-r from-cyan-400 to-purple-500 px-1.5 py-0.5 text-[9px] font-display font-extrabold text-slate-950">
                            BOT
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-amber-300 tabular-nums">
                      {p.tournamentChips.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 capitalize font-semibold">
                      <span className={
                        p.status === 'winner'
                          ? 'text-amber-400'
                          : p.status === 'active'
                            ? 'text-emerald-400'
                            : p.status === 'eliminated'
                              ? 'text-rose-400'
                              : 'text-sky-400'
                      }>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Winner Celebration Screen (matches Reference Image 2 #9) */}
      {tab === 'winner' && winnerPlayer && (
        <div className="rounded-[34px] border-2 border-amber-400/65 bg-gradient-to-b from-amber-950/45 via-[#0d142c] to-[#060911] p-6 sm:p-10 text-center space-y-5 shadow-[0_0_55px_rgba(245,158,11,0.3)]">
          <div className="w-20 h-20 rounded-full bg-amber-400/20 border-2 border-amber-300/70 flex items-center justify-center mx-auto text-amber-300 shadow-[0_0_32px_rgba(250,204,21,0.55)]">
            <Trophy className="w-10 h-10" />
          </div>
          <div>
            <h2 className="text-2xl sm:text-3xl font-display font-extrabold text-amber-300">
              Congratulations!
            </h2>
            <p className="text-base sm:text-lg font-display font-bold text-white mt-1 flex items-center justify-center gap-2">
              <span>{winnerPlayer.username} Won the Tournament!</span>
              {winnerPlayer.isBot && (
                <span className="rounded-full bg-gradient-to-r from-cyan-400 to-purple-500 px-2 py-0.5 text-[10px] font-display font-extrabold text-slate-950">
                  BOT
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-col items-center gap-2">
            <PlayerAvatar avatarId={winnerPlayer.avatarId} username={winnerPlayer.username} size="xl" className="ring-4 ring-amber-400" />
            <span className="px-4 py-1 rounded-full btn-glossy btn-glossy-gold text-slate-950 font-display font-extrabold text-xs">
              1st Place Champion
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 max-w-md mx-auto pt-2">
            <div className="rounded-2xl glass-bubbly p-3">
              <p className="text-[11px] text-slate-400">Final Chips</p>
              <p className="font-mono text-base font-bold text-amber-300 tabular-nums">
                {winnerPlayer.tournamentChips.toLocaleString()}
              </p>
            </div>
            <div className="rounded-2xl glass-bubbly p-3">
              <p className="text-[11px] text-slate-400">Eliminated</p>
              <p className="font-mono text-base font-bold text-white tabular-nums">
                {Math.max(0, t.registeredCount - 1)}
              </p>
            </div>
            <div className="rounded-2xl glass-bubbly p-3">
              <p className="text-[11px] text-slate-400">Total Hands</p>
              <p className="font-mono text-base font-bold text-white tabular-nums">{t.totalHandsPlayed}</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto pt-2">
            <button
              type="button"
              onClick={onPlayAnother}
              className="flex-1 py-3 rounded-full btn-glossy btn-glossy-blue text-white font-display font-bold text-sm"
            >
              Play Another Tournament
            </button>
            <button
              type="button"
              onClick={onBack}
              className="flex-1 py-3 rounded-full btn-glossy btn-glossy-dark text-slate-200 font-display font-bold text-sm"
            >
              Back to Lobby
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
