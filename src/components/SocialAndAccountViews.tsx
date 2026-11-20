import React, { useEffect, useState } from 'react';
import {
  Award,
  Bell,
  Check,
  ChevronLeft,
  Clock,
  Coins,
  Crown,
  Gift,
  History,
  LogOut,
  Search,
  Send,
  Settings,
  Shield,
  Trash2,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch, makeIdempotencyKey } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import type {
  ChatMessageItem,
  ChipTransaction,
  FriendItem,
  FriendRequestItem,
  GameHistoryItem,
  GameSpeed,
  LeaderboardEntry,
  NotificationItem,
} from '../shared/types.ts';
import { AVATAR_OPTIONS, PlayerAvatar } from '../utils/avatars.tsx';
import { PWAInstallButton } from './PWAInstallButton.tsx';
import type { AppScreen } from './LobbyViews.tsx';

// 19. PLAYER PROFILE
export const PlayerProfileView: React.FC<{
  onNavigate: (s: AppScreen) => void;
  onBack: () => void;
}> = ({ onNavigate, onBack }) => {
  const { user, wallet, stats, achievements, updateProfile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(user?.username || '');
  const [avatarId, setAvatarId] = useState(user?.avatarId || 'ace-spade');
  const [bio, setBio] = useState(user?.bio || '');
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;
  const winRate =
    stats && stats.pokerHandsPlayed > 0
      ? Math.round((stats.pokerHandsWon / stats.pokerHandsPlayed) * 100)
      : 0;
  const xpProgress = user.xp % 250;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await updateProfile({ username, avatarId, bio });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile');
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="btn-glossy btn-glossy-dark w-10 h-10 rounded-full flex items-center justify-center text-slate-200">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-display font-bold text-white">Player Profile</h1>
        </div>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="btn-glossy btn-glossy-dark px-4 py-2 rounded-full text-xs font-semibold text-cyan-300"
        >
          {editing ? 'Cancel' : 'Edit Profile'}
        </button>
      </div>

      {error && <div className="rounded-2xl bg-rose-500/15 border border-rose-500/40 px-4 py-2 text-xs text-rose-300">{error}</div>}

      <div className="glass-bubbly rounded-[32px] p-5 sm:p-6 space-y-5">
        {editing ? (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {AVATAR_OPTIONS.map((av) => (
                <button
                  key={av.id}
                  type="button"
                  onClick={() => setAvatarId(av.id)}
                  className={`p-1 rounded-full ${avatarId === av.id ? 'ring-2 ring-cyan-400' : 'opacity-65'}`}
                >
                  <PlayerAvatar avatarId={av.id} size="md" />
                </button>
              ))}
            </div>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-bubbly w-full rounded-2xl px-4 py-2.5 text-sm text-white"
              placeholder="Username"
            />
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              className="input-bubbly w-full rounded-2xl px-4 py-2.5 text-sm text-white"
              placeholder="Player bio..."
            />
            <button type="submit" className="btn-glossy btn-glossy-green px-6 py-2.5 rounded-full text-slate-950 font-display font-extrabold text-xs">
              Save Changes
            </button>
          </form>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <PlayerAvatar avatarId={user.avatarId} username={user.username} size="xl" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-display font-bold text-white truncate">{user.username}</h2>
                <span className="text-xs font-mono text-cyan-300">Lv.{user.level}</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{user.bio || 'Midnight Poker Club player'}</p>
              <div className="mt-2.5">
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400" style={{ width: `${(xpProgress / 250) * 100}%` }} />
                </div>
                <p className="text-[11px] font-mono text-slate-400 mt-1 tabular-nums">{xpProgress} / 250 XP to Level {user.level + 1}</p>
              </div>
            </div>
          </div>
        )}

        {/* Authentic 2x2 Stats Grid (matches Reference Image 1 Middle-Right) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3.5">
            <p className="text-xs text-slate-400">Total Chips</p>
            <p className="font-mono text-lg font-bold text-amber-300 tabular-nums mt-1">
              {(wallet?.chipBalance ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3.5">
            <p className="text-xs text-slate-400">Hands Played</p>
            <p className="font-mono text-lg font-bold text-white tabular-nums mt-1">
              {stats?.pokerHandsPlayed ?? 0}
            </p>
          </div>
          <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3.5">
            <p className="text-xs text-slate-400">Hands Won</p>
            <p className="font-mono text-lg font-bold text-emerald-400 tabular-nums mt-1">
              {stats?.pokerHandsWon ?? 0}
            </p>
          </div>
          <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3.5">
            <p className="text-xs text-slate-400">Win Rate</p>
            <p className="font-mono text-lg font-bold text-cyan-300 tabular-nums mt-1">{winRate}%</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl bg-slate-900/50 border border-slate-800/80 p-3">
            <span className="text-slate-400 block">Tournaments</span>
            <span className="font-mono font-bold text-white">{stats?.tournamentsWon ?? 0} won / {stats?.tournamentsPlayed ?? 0}</span>
          </div>
          <div className="rounded-xl bg-slate-900/50 border border-slate-800/80 p-3">
            <span className="text-slate-400 block">Blackjack Wins</span>
            <span className="font-mono font-bold text-white">{stats?.blackjackHandsWon ?? 0} ({stats?.blackjackBlackjacks ?? 0} BJ)</span>
          </div>
          <div className="rounded-xl bg-slate-900/50 border border-slate-800/80 p-3">
            <span className="text-slate-400 block">Lifetime Won</span>
            <span className="font-mono font-bold text-emerald-400">+{(wallet?.lifetimeWon ?? 0).toLocaleString()}</span>
          </div>
          <div className="rounded-xl bg-slate-900/50 border border-slate-800/80 p-3">
            <span className="text-slate-400 block">Lifetime Lost</span>
            <span className="font-mono font-bold text-rose-400">-{(wallet?.lifetimeLost ?? 0).toLocaleString()}</span>
          </div>
        </div>

        {/* Achievements */}
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Achievement Badges</h3>
          <div className="flex flex-wrap gap-2">
            {achievements.map((a) => (
              <div key={a.badgeKey} className="inline-flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-400/30 px-3 py-2 text-xs">
                <Award className="w-4 h-4 text-amber-300 shrink-0" />
                <div>
                  <p className="font-semibold text-amber-200">{a.title}</p>
                  <p className="text-[11px] text-slate-400">{a.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Navigation Links */}
        <div className="divide-y divide-slate-800/80 rounded-2xl border border-slate-800 bg-slate-950/60 overflow-hidden">
          {[
            { label: 'Account Settings', icon: Settings, screen: 'settings' as AppScreen },
            { label: 'Game History', icon: History, screen: 'history' as AppScreen },
            { label: 'Friends & Chip Gifts', icon: Users, screen: 'friends' as AppScreen },
            { label: 'Virtual Chip Wallet', icon: Wallet, screen: 'wallet' as AppScreen },
            ...(user.role === 'admin' ? [{ label: 'Admin Dashboard', icon: Shield, screen: 'admin' as AppScreen }] : []),
          ].map((row) => (
            <button
              key={row.screen}
              type="button"
              onClick={() => onNavigate(row.screen)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-slate-200 hover:bg-slate-800/70 transition"
            >
              <span className="flex items-center gap-2.5">
                <row.icon className="w-4 h-4 text-cyan-400" />
                {row.label}
              </span>
              <span className="text-slate-500">›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// 20. FRIENDS & CHIP GIFTS
export const FriendsView: React.FC<{ onBack: () => void; onRequestsChanged?: () => void; onJoinFriendRoom: (roomId: string, friendId: string) => void; onWatchFriendRoom: (roomId: string, friendId: string, username: string) => void }> = ({
  onBack,
  onRequestsChanged,
  onJoinFriendRoom,
  onWatchFriendRoom,
}) => {
  const { refreshWallet, setWalletBalanceLocally } = useAuth();
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestItem[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestItem[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ userId: string; username: string; avatarId: string; level: number; isFriend: boolean }>>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [requestedIds, setRequestedIds] = useState<string[]>([]);
  const [giftTarget, setGiftTarget] = useState<FriendItem | null>(null);
  const [giftAmount, setGiftAmount] = useState(250);
  const [giftRequestKey, setGiftRequestKey] = useState<string | null>(null);
  const [giftSending, setGiftSending] = useState(false);
  const [giftError, setGiftError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadFriends = async () => {
    const [roster, tables] = await Promise.all([
      apiFetch<{ friends: FriendItem[]; incomingRequests: FriendRequestItem[]; outgoingRequests: FriendRequestItem[] }>('/api/friends'),
      apiFetch<{ friends: FriendItem[] }>('/api/friends/tables'),
    ]);
    setFriends(tables.friends || roster.friends || []);
    setIncoming(roster.incomingRequests || []);
    setOutgoing(roster.outgoingRequests || []);
  };

  useEffect(() => {
    void loadFriends().catch(() => setNotice('Friends list could not refresh'));
    const timer = setInterval(() => {
      void loadFriends().catch(() => {});
    }, 12000);
    return () => clearInterval(timer);
  }, []);

  const searchPlayers = async (term: string, cancelled: () => boolean) => {
    if (term.length < 2) {
      setSearchResults([]);
      setHasSearched(false);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await apiFetch<{ players: typeof searchResults }>(`/api/players/search?q=${encodeURIComponent(term)}`);
      if (!cancelled()) {
        setSearchResults(res.players || []);
        setHasSearched(true);
      }
    } catch (err) {
      if (!cancelled()) {
        setSearchResults([]);
        setHasSearched(true);
        setSearchError(err instanceof Error ? err.message : 'Could not search players');
      }
    } finally {
      if (!cancelled()) setSearching(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchPlayers(query.trim(), () => cancelled);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Typing searches automatically; submitting also triggers an immediate lookup.
    void searchPlayers(query.trim(), () => false);
  };

  const sendRequest = async (receiverId: string) => {
    try {
      await apiFetch('/api/friends/request', { method: 'POST', body: JSON.stringify({ receiverId }) });
      setNotice('Friend request sent');
      setRequestedIds((ids) => [...ids, receiverId]);
      await loadFriends();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to send request');
    }
  };

  const respondRequest = async (id: string, accept: boolean) => {
    try {
      await apiFetch(`/api/friends/requests/${id}/respond`, { method: 'POST', body: JSON.stringify({ accept }) });
      setIncoming((items) => items.filter((item) => item.id !== id));
      onRequestsChanged?.();
      await loadFriends();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to respond to request');
    }
  };

  const openGift = (friend: FriendItem) => {
    setGiftTarget(friend);
    setGiftAmount(250);
    setGiftRequestKey(makeIdempotencyKey('gift'));
    setGiftError(null);
    setNotice(null);
  };

  const sendGift = async () => {
    if (!giftTarget || giftSending) return;
    if (!Number.isSafeInteger(giftAmount) || giftAmount < 1 || giftAmount > 10000) {
      setGiftError('Enter a whole chip amount between 1 and 10,000.');
      return;
    }
    setGiftSending(true);
    setGiftError(null);
    try {
      // Retain the same request key if the network fails, so retrying cannot
      // accidentally debit the sender twice after a successful server commit.
      const response = await apiFetch<{ ok: boolean; message: string; newBalance: number }>('/api/wallet/transfer', {
        method: 'POST',
        body: JSON.stringify({
          recipientId: giftTarget.userId,
          amount: giftAmount,
          idempotencyKey: giftRequestKey,
        }),
      });
      if (!response.ok || !Number.isSafeInteger(response.newBalance)) {
        throw new Error('Gift status not confirmed. Please refresh your wallet.');
      }
      setWalletBalanceLocally(response.newBalance);
      setNotice(`Chips sent! ${giftAmount.toLocaleString()} virtual chips to ${giftTarget.username}.`);
      setGiftTarget(null);
      setGiftRequestKey(null);
      // The confirmed transfer must not become an error if refreshing fails.
      void refreshWallet().catch(() => {});
    } catch (err) {
      setGiftError(err instanceof Error ? err.message : 'Unable to send chips. Please try again.');
    } finally {
      setGiftSending(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="btn-glossy btn-glossy-dark w-10 h-10 rounded-full flex items-center justify-center text-slate-200">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-display font-bold text-white">Friends</h1>
      </div>

      {notice && <div role="status" aria-live="polite" className="rounded-2xl bg-emerald-500/15 border border-emerald-400/40 px-4 py-3 text-sm font-semibold text-emerald-200">{notice}</div>}

      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            aria-label="Search players by username"
            placeholder="Search players by username..."
            className="input-bubbly w-full rounded-full pl-10 pr-4 py-2.5 text-sm text-white"
          />
        </div>
        <button type="submit" disabled={query.trim().length < 2 || searching} className="btn-glossy btn-glossy-blue px-5 py-2.5 rounded-full text-white font-bold text-xs disabled:opacity-60">
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {query.trim().length === 1 && (
        <p className="text-xs text-slate-400 px-2">Type at least 2 characters to find players.</p>
      )}
      {searchError && (
        <div role="alert" className="rounded-2xl border border-rose-400/40 bg-rose-950/25 px-4 py-3 text-sm text-rose-200">
          {searchError}
        </div>
      )}
      {hasSearched && !searching && !searchError && searchResults.length === 0 && (
        <div className="glass-bubbly rounded-[24px] px-4 py-5 text-center">
          <p className="text-sm font-bold text-white">No players found for “{query.trim()}”</p>
          <p className="text-xs text-slate-400 mt-1">Check the spelling or try part of their username.</p>
        </div>
      )}
      {searchResults.length > 0 && (
        <div className="glass-bubbly rounded-[28px] p-4 space-y-2" aria-live="polite">
          <h2 className="text-xs font-semibold text-slate-400 uppercase">Search Results</h2>
          {searchResults.map((p) => (
            <div key={p.userId} className="flex items-center justify-between py-2 border-b border-slate-800/60 last:border-0">
              <div className="flex items-center gap-2.5">
                <PlayerAvatar avatarId={p.avatarId} username={p.username} size="sm" />
                <div>
                  <p className="text-sm font-semibold text-white">{p.username}</p>
                  <p className="text-[11px] text-slate-400">Level {p.level}</p>
                </div>
              </div>
              {p.isFriend ? (
                <span className="text-xs text-emerald-400 flex items-center gap-1"><UserCheck className="w-4 h-4" /> Friend</span>
              ) : (requestedIds.includes(p.userId) || outgoing.some((r) => r.receiverId === p.userId)) ? (
                <span className="text-xs text-amber-300">Request sent</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void sendRequest(p.userId)}
                  className="btn-glossy btn-glossy-blue inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Add Friend
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {incoming.length > 0 && (
        <div className="glass-bubbly rounded-[28px] border border-amber-500/30 p-4 space-y-2.5">
          <h2 className="text-xs font-semibold text-amber-300 uppercase">Incoming Friend Requests</h2>
          {incoming.map((req) => (
            <div key={req.id} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <PlayerAvatar avatarId={req.senderAvatarId} username={req.senderUsername} size="sm" />
                <span className="text-sm font-semibold text-white">{req.senderUsername}</span>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => void respondRequest(req.id, true)} className="btn-glossy btn-glossy-green p-2 rounded-full text-slate-950">
                  <Check className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => void respondRequest(req.id, false)} className="btn-glossy btn-glossy-dark p-2 rounded-full text-rose-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="glass-bubbly rounded-[28px] p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase">Your Friends ({friends.length})</h2>
          <span className="text-xs text-emerald-300 font-bold">{friends.filter((f) => f.online).length} online</span>
        </div>
        {friends.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">No friends added yet. Search usernames above to connect.</p>
        ) : (
          friends.map((f) => (
            <div key={f.userId} className="flex items-center justify-between gap-2 py-2 border-b border-slate-800/60 last:border-0">
              <div className="flex items-center gap-2.5">
                <PlayerAvatar avatarId={f.avatarId} username={f.username} size="sm" />
                <div>
                  <p className="text-sm font-semibold text-white">{f.username}</p>
                  <p className="text-[11px] text-slate-400">
                    {f.online ? (f.currentRoomName && f.canWatch ? `Playing: ${f.currentRoomName}` : 'Online now') : 'Offline'}
                    {f.currentRoomName && !f.canWatch && f.canJoin ? ` · Table open: ${f.currentRoomName}` : ''}
                    {f.currentRoomId && f.roomMaxPlayers ? ` · ${f.roomPlayerCount ?? 0}/${f.roomMaxPlayers} seats` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {f.currentRoomId && f.canWatch && (
                  <button
                    type="button"
                    onClick={() => onWatchFriendRoom(f.currentRoomId!, f.userId, f.username)}
                    className="btn-glossy px-3 py-1.5 rounded-full text-xs font-bold text-cyan-100 border border-cyan-500/50 bg-cyan-900/60"
                  >
                    Watch Game
                  </button>
                )}
                {f.currentRoomId && f.canJoin && (
                  <button
                    type="button"
                    onClick={() => onJoinFriendRoom(f.currentRoomId!, f.userId)}
                    className="btn-glossy btn-glossy-green px-3 py-1.5 rounded-full text-xs font-bold text-slate-950"
                  >
                    Join Game
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openGift(f)}
                  className="btn-glossy btn-glossy-gold px-3 py-1.5 rounded-full text-xs font-bold text-slate-950"
                >
                  Gift Chips
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {giftTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="glass-bubbly w-full max-w-sm rounded-[28px] p-5 space-y-4">
            <h3 className="text-base font-display font-bold text-white">Send Virtual Chips to {giftTarget.username}</h3>
            <p className="text-xs text-slate-300">Only accepted friends can receive chips. Maximum 10,000 per gift.</p>
            {giftError && <p role="alert" className="rounded-xl bg-rose-950/60 border border-rose-400/60 p-3 text-sm text-rose-200">{giftError}</p>}
            <input
              type="number"
              min={1}
              max={10000}
              step={1}
              value={giftAmount}
              onChange={(e) => setGiftAmount(Number(e.target.value))}
              className="input-bubbly w-full rounded-2xl px-4 py-2.5 text-sm font-mono text-amber-300"
            />
            <div className="flex gap-2">
              <button type="button" disabled={giftSending} onClick={() => { setGiftTarget(null); setGiftRequestKey(null); setGiftError(null); }} className="btn-glossy btn-glossy-dark flex-1 py-2.5 rounded-full text-xs text-slate-200 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" disabled={giftSending || !Number.isSafeInteger(giftAmount) || giftAmount < 1 || giftAmount > 10000} onClick={() => void sendGift()} className="btn-glossy btn-glossy-gold flex-1 py-2.5 rounded-full text-slate-950 font-bold text-xs disabled:opacity-50">
                {giftSending ? 'Sending...' : 'Send Chips'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 21. INBOX & NOTIFICATIONS
export const InboxView: React.FC<{ onBack: () => void; onJoinCode: (code: string) => void }> = ({ onBack, onJoinCode }) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [directMessages, setDirectMessages] = useState<ChatMessageItem[]>([]);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [dmText, setDmText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInbox = async () => {
    const [inboxRes, friendsRes] = await Promise.all([
      apiFetch<{ notifications: NotificationItem[]; directMessages: ChatMessageItem[] }>('/api/inbox'),
      apiFetch<{ friends: FriendItem[] }>('/api/friends'),
    ]);
    setNotifications(inboxRes.notifications || []);
    setDirectMessages(inboxRes.directMessages || []);
    setFriends(friendsRes.friends || []);
  };

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active) void loadInbox().catch(() => { if (active) setError('Unable to refresh messages.'); });
    };
    refresh();
    const interval = window.setInterval(refresh, 12000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, []);

  const markAllRead = async () => {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' });
      await loadInbox();
    } catch { setError('Unable to mark notifications as read.'); }
  };

  // Each conversation has its own card; recipients are taken from the message
  // record instead of assuming every message belongs to the selected friend.
  const peers = new Map<string, { userId: string; username: string; avatarId: string; latest?: ChatMessageItem }>();
  for (const friend of friends) {
    peers.set(friend.userId, { userId: friend.userId, username: friend.username, avatarId: friend.avatarId });
  }
  for (const m of directMessages) {
    const peerId = m.senderId === user?.id ? m.recipientId : m.senderId;
    if (!peerId) continue;
    const existing = peers.get(peerId);
    const name = m.senderId === peerId ? m.senderUsername : (m.recipientUsername || existing?.username || 'Player');
    const avatar = m.senderId === peerId ? m.senderAvatarId : (m.recipientAvatarId || existing?.avatarId || 'ace-spade');
    peers.set(peerId, {
      userId: peerId,
      username: existing?.username || name,
      avatarId: existing?.avatarId || avatar,
      latest: !existing?.latest || m.createdAt > existing.latest.createdAt ? m : existing.latest,
    });
  }
  const conversations = [...peers.values()].sort((a, b) =>
    (b.latest?.createdAt || '').localeCompare(a.latest?.createdAt || '') || a.username.localeCompare(b.username)
  );
  const activeFriend = selectedFriendId ? peers.get(selectedFriendId) : null;
  const activeMessages = directMessages.filter(m =>
    m.senderId === selectedFriendId && m.recipientId === user?.id ||
    m.senderId === user?.id && m.recipientId === selectedFriendId
  );

  const sendDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFriendId || !dmText.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await apiFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          channelType: 'direct', channelId: selectedFriendId,
          recipientId: selectedFriendId, message: dmText.trim(),
        }),
      });
      setDmText('');
      await loadInbox();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Message could not be sent.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={selectedFriendId ? () => setSelectedFriendId(null) : onBack} aria-label="Back"
          className="btn-glossy btn-glossy-dark w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-slate-200">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg sm:text-xl font-display font-bold text-white min-w-0 flex-1">
          {activeFriend ? activeFriend.username : 'Inbox & Notifications'}
        </h1>
        {!selectedFriendId && (
          <button type="button" onClick={() => void markAllRead()} className="text-xs font-semibold text-cyan-300 shrink-0">
            Mark read
          </button>
        )}
      </div>

      {error && <p role="alert" className="rounded-xl border border-rose-400/50 bg-rose-950/50 px-3 py-2 text-sm text-rose-200">{error}</p>}

      {!selectedFriendId && (
        <>
          <section className="glass-bubbly rounded-[24px] p-3 sm:p-4 space-y-2.5" aria-label="Notifications">
            <h2 className="text-xs font-semibold uppercase text-amber-200 flex gap-2 items-center">
              <Bell className="w-4 h-4" /> Notifications
            </h2>
            {notifications.length === 0 ? (
              <p className="text-sm text-slate-400">No notifications yet.</p>
            ) : notifications.map(n => (
              <div key={n.id} className={'rounded-2xl border p-3 ' + (n.isRead ? 'bg-slate-900/50 border-slate-700/60' : 'bg-cyan-950/30 border-cyan-500/40')}>
                <div className="flex justify-between items-start gap-2">
                  <p className="text-sm font-semibold text-white">{n.title}</p>
                  <span className="text-[10px] text-slate-400 shrink-0">{new Date(n.createdAt).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</span>
                </div>
                <p className="text-xs text-slate-300 mt-1">{n.body}</p>
                {n.actionUrl?.startsWith('#join-code:') && (
                  <button type="button" onClick={() => onJoinCode(n.actionUrl!.replace('#join-code:', ''))}
                    className="mt-2 btn-glossy btn-glossy-blue px-3 py-1.5 rounded-full text-xs font-bold">Join table</button>
                )}
              </div>
            ))}
          </section>

          <section className="glass-bubbly rounded-[24px] p-3 sm:p-4 space-y-3" aria-label="Conversations">
            <h2 className="text-xs uppercase tracking-wider text-amber-200 font-bold">Messages · Tap a friend to open</h2>
            {conversations.length === 0 ? (
              <p className="text-sm text-slate-400">Add friends to start a conversation.</p>
            ) : conversations.map(peer => (
              <div key={peer.userId} className="flex items-center gap-2 rounded-2xl border border-cyan-600/35 bg-slate-950/65 p-2.5 sm:p-3">
                <PlayerAvatar playerId={peer.userId} avatarId={peer.avatarId} username={peer.username} size="md" />
                <button type="button" onClick={() => { setSelectedFriendId(peer.userId); setError(null); }}
                  className="min-w-0 flex-1 text-left flex items-center gap-2" aria-label={'Open conversation with ' + peer.username}>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-white text-sm truncate">{peer.username}</strong>
                    <span className="block text-xs text-slate-300 truncate">
                      {peer.latest ? ((peer.latest.senderId === user?.id ? 'You: ' : peer.username + ': ') + peer.latest.message) : 'Start a conversation'}
                    </span>
                  </span>
                  <span className="text-amber-300 text-lg shrink-0">›</span>
                </button>
              </div>
            ))}
          </section>
        </>
      )}

      {selectedFriendId && activeFriend && (
        <section className="glass-bubbly rounded-[24px] p-3 sm:p-4 space-y-3" aria-label={'Conversation with ' + activeFriend.username}>
          <div className="flex items-center gap-3 border-b border-slate-700/70 pb-3">
            <PlayerAvatar playerId={activeFriend.userId} avatarId={activeFriend.avatarId} username={activeFriend.username} size="md" />
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-white truncate">{activeFriend.username}</h2>
              <p className="text-xs text-slate-400">Tap their picture to view their profile</p>
            </div>
          </div>
          <div className="space-y-3 max-h-[55dvh] min-h-32 overflow-y-auto py-2" aria-live="polite">
            {activeMessages.length === 0 && (
              <p className="text-center text-sm text-slate-400 py-8">No messages yet. Say hello!</p>
            )}
            {activeMessages.map(m => {
              const mine = m.senderId === user?.id;
              return (
                <div key={m.id} className={'flex items-end gap-2 ' + (mine ? 'justify-end' : 'justify-start')}>
                  {!mine && <PlayerAvatar playerId={m.senderId} avatarId={m.senderAvatarId} username={m.senderUsername} size="xs" />}
                  <div className={'min-w-0 max-w-[85%] rounded-2xl border p-3 ' +
                    (mine ? 'bg-emerald-950/80 border-emerald-400/50' : 'bg-slate-900/90 border-cyan-500/35')}>
                    <p className={'text-[11px] font-semibold mb-1 ' + (mine ? 'text-emerald-300' : 'text-cyan-300')}>
                      {mine ? 'You → ' + activeFriend.username : m.senderUsername + ' → You'}
                    </p>
                    <p className="text-sm text-white whitespace-pre-wrap break-words">{m.message}</p>
                    <p className="text-[10px] text-slate-400 mt-2 text-right">
                      {new Date(m.createdAt).toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})}
                    </p>
                  </div>
                  {mine && <PlayerAvatar playerId={user?.id} avatarId={user?.avatarId} username={user?.username} size="xs" />}
                </div>
              );
            })}
          </div>
          <form onSubmit={sendDirect} className="flex items-end gap-2">
            <input value={dmText} maxLength={400} onChange={e => setDmText(e.target.value)}
              placeholder={'Message ' + activeFriend.username + '…'} aria-label="Direct message"
              className="input-bubbly min-w-0 flex-1 rounded-full px-4 py-3 text-sm text-white" />
            <button type="submit" disabled={sending || !dmText.trim() || !friends.some(f => f.userId === selectedFriendId)}
              className="btn-glossy btn-glossy-blue shrink-0 p-3 rounded-full text-white disabled:opacity-40" aria-label="Send message">
              <Send className="w-5 h-5" />
            </button>
          </form>
          {!friends.some(f => f.userId === selectedFriendId) &&
            <p className="text-xs text-slate-400">You can view old messages, but must be friends to send new ones.</p>}
        </section>
      )}
    </div>
  );
};

// 22. LEADERBOARDS
export const LeaderboardsView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [board, setBoard] = useState<Record<string, LeaderboardEntry[]>>({});
  const [tab, setTab] = useState<'chipBalances' | 'handsWon' | 'tournamentsWon' | 'winPercentage' | 'blackjackWins' | 'playerLevels'>('chipBalances');

  useEffect(() => {
    void apiFetch<Record<string, LeaderboardEntry[]>>('/api/leaderboards').then(setBoard);
  }, []);

  const rows = board[tab] || [];

  return (
    <div className="max-w-4xl min-w-0 mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-start gap-3 min-w-0">
        <button type="button" onClick={onBack} className="btn-glossy btn-glossy-dark w-10 h-10 rounded-full flex items-center justify-center text-slate-200">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-display font-bold text-white break-words">Club Leaderboards</h1>
          <p className="text-xs text-slate-400">Live rankings computed from verified player records (Win % requires 5+ hands)</p>
        </div>
      </div>

      <div role="group" aria-label="Leaderboard categories, scroll for more" className="flex w-full max-w-full min-w-0 gap-3 overflow-x-auto overscroll-x-contain pb-3 pt-1 [scrollbar-width:thin] [scrollbar-color:#a78bfa_transparent]">
        {[
          { id: 'chipBalances', label: 'Top Chips' },
          { id: 'handsWon', label: 'Hold\'em Wins' },
          { id: 'tournamentsWon', label: 'Tournaments' },
          { id: 'winPercentage', label: 'Win %' },
          { id: 'blackjackWins', label: 'Blackjack' },
          { id: 'playerLevels', label: 'Levels' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as typeof tab)}
            aria-pressed={tab === t.id}
            className={`btn-glossy flex-none shrink-0 min-w-max px-5 py-2.5 rounded-full text-sm font-bold whitespace-nowrap ${
              tab === t.id ? 'btn-glossy-gold text-slate-950' : 'btn-glossy-dark text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="glass-bubbly rounded-[28px] overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-400">No qualifying players in this category yet.</p>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {rows.map((r) => (
              <div key={r.userId} className="flex items-center justify-between gap-3 px-4 py-3 min-w-0">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className={`w-7 text-center font-mono text-sm font-bold ${r.rank <= 3 ? 'text-amber-300' : 'text-slate-500'}`}>
                    #{r.rank}
                  </span>
                  <PlayerAvatar avatarId={r.avatarId} username={r.username} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white break-words">{r.username}</p>
                    <p className="text-[11px] text-slate-400 break-words">Level {r.level} · {r.secondaryLabel}</p>
                  </div>
                </div>
                <span className="shrink-0 text-right font-mono text-xs sm:text-sm font-bold text-amber-300 tabular-nums">
                  {tab === 'winPercentage' ? `${r.value}%` : r.value.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// 23. GAME HISTORY (matches Reference Image 1 Bottom-Right)
export const GameHistoryView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [items, setItems] = useState<GameHistoryItem[]>([]);

  useEffect(() => {
    void apiFetch<{ history: GameHistoryItem[] }>('/api/history').then((d) => setItems(d.history || []));
  }, []);

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="btn-glossy btn-glossy-dark w-10 h-10 rounded-full flex items-center justify-center text-slate-200">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-display font-bold text-white">Game History</h1>
      </div>

      <div className="glass-bubbly rounded-[28px] divide-y divide-slate-800/70">
        {items.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-400">Play Texas Hold&apos;em or Blackjack hands to populate your authentic game history.</p>
        ) : (
          items.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div>
                <p className="text-sm font-display font-bold text-white">
                  {h.gameType === 'holdem' ? "Texas Hold'em" : h.gameType === 'blackjack' ? 'Blackjack' : 'Tournament'} · {h.roomName}
                </p>
                <p className={`text-xs font-semibold mt-0.5 ${h.netChips >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {h.summary}
                </p>
              </div>
              <span className="text-[11px] text-slate-500 font-mono whitespace-nowrap">
                {new Date(h.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// 24. VIRTUAL CHIP WALLET
export const WalletView: React.FC<{ onBack: () => void; onOpenDailyBonus: () => void }> = ({ onBack, onOpenDailyBonus }) => {
  const { wallet } = useAuth();
  const [txs, setTxs] = useState<ChipTransaction[]>([]);

  useEffect(() => {
    void apiFetch<{ transactions: ChipTransaction[] }>('/api/wallet').then((d) => setTxs(d.transactions || []));
  }, []);

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="btn-glossy btn-glossy-dark w-10 h-10 rounded-full flex items-center justify-center text-slate-200">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-display font-bold text-white">Virtual Chip Wallet</h1>
      </div>

      <div className="glass-bubbly rounded-[32px] border border-amber-400/45 bg-gradient-to-br from-amber-950/35 to-[#0b1020] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wider">Available Virtual Chips (Entertainment Only)</p>
          <p className="text-3xl font-mono font-extrabold text-amber-300 tabular-nums mt-1">
            {(wallet?.chipBalance ?? 0).toLocaleString()}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">No real-money value, deposits, or cash redemptions.</p>
        </div>
        <button
          type="button"
          onClick={onOpenDailyBonus}
          className="btn-glossy btn-glossy-gold px-6 py-3 rounded-full text-slate-950 font-display font-extrabold text-xs whitespace-nowrap"
        >
          Daily 2,000 Refill
        </button>
      </div>

      <div className="glass-bubbly rounded-[28px] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800">
          <h2 className="text-sm font-display font-bold text-white">Transaction Audit Ledger</h2>
        </div>
        <div className="divide-y divide-slate-800/70">
          {txs.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between px-4 py-3 text-xs">
              <div>
                <p className="font-semibold text-white">{tx.description}</p>
                <p className="text-slate-500 mt-0.5">{tx.txType.replace(/_/g, ' ')} · {new Date(tx.createdAt).toLocaleString()}</p>
              </div>
              <div className="text-right font-mono tabular-nums">
                <p className={`font-bold ${tx.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString()}
                </p>
                <p className="text-[11px] text-slate-400">Bal: {tx.balanceAfter.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// 25. DAILY BONUS
export const DailyBonusView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { wallet, refreshWallet } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const handleClaim = async () => {
    setError(null);
    setMessage(null);
    setClaiming(true);
    try {
      const res = await apiFetch<{ claimed: boolean; newBalance: number; streak: number }>('/api/wallet/daily-bonus', {
        method: 'POST',
      });
      await refreshWallet();
      setMessage(`Claimed 2,000 virtual chips! Streak: Day ${res.streak}. New balance: ${res.newBalance.toLocaleString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Daily bonus not yet available');
    } finally {
      setClaiming(false);
    }
  };

  const nextClaimStr = wallet?.nextDailyBonusAt ? new Date(wallet.nextDailyBonusAt).toLocaleString() : 'Available Now';

  return (
    <div className="max-w-lg mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="btn-glossy btn-glossy-dark w-10 h-10 rounded-full flex items-center justify-center text-slate-200">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-display font-bold text-white">Daily Chip Refill</h1>
      </div>

      <div className="glass-bubbly rounded-[34px] border border-amber-400/45 p-6 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-amber-400/15 border border-amber-400/40 flex items-center justify-center text-amber-300 mx-auto shadow-[0_0_24px_rgba(250,204,21,0.3)]">
          <Gift className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-2xl font-display font-extrabold text-white">2,000 Virtual Chips</h2>
          <p className="text-xs text-slate-400 mt-1">Claimable once every 24 hours · Current Streak: {wallet?.dailyStreak ?? 0} days</p>
        </div>

        {message && <div className="rounded-2xl bg-emerald-500/15 border border-emerald-500/40 p-3 text-xs text-emerald-300">{message}</div>}
        {error && <div className="rounded-2xl bg-rose-500/15 border border-rose-500/40 p-3 text-xs text-rose-300">{error}</div>}

        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-3 text-xs text-slate-300 flex items-center justify-center gap-2">
          <Clock className="w-4 h-4 text-cyan-400" />
          <span>Next eligibility: {nextClaimStr}</span>
        </div>

        <button
          type="button"
          disabled={claiming}
          onClick={handleClaim}
          className="btn-glossy btn-glossy-gold w-full py-3.5 rounded-full text-slate-950 font-display font-extrabold text-sm"
        >
          {claiming ? 'Claiming...' : 'Claim 2,000 Daily Chips'}
        </button>
      </div>
    </div>
  );
};

// 26. SETTINGS
export const SettingsView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { user, supabaseConfigured, updateProfile, logout, deleteAccount } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="btn-glossy btn-glossy-dark w-10 h-10 rounded-full flex items-center justify-center text-slate-200">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-display font-bold text-white">Account Settings</h1>
      </div>

      <div className="glass-bubbly rounded-[32px] p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Card &amp; Chip Sound Effects</p>
            <p className="text-xs text-slate-400">Play realistic audio cues during gameplay</p>
          </div>
          <input
            type="checkbox"
            checked={user.soundEnabled}
            onChange={(e) => void updateProfile({ soundEnabled: e.target.checked })}
            className="w-5 h-5 accent-cyan-400"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Ambient Lounge Pad</p>
            <p className="text-xs text-slate-400">Subtle background synthesizer music</p>
          </div>
          <input
            type="checkbox"
            checked={user.musicEnabled}
            onChange={(e) => void updateProfile({ musicEnabled: e.target.checked })}
            className="w-5 h-5 accent-cyan-400"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            SFX Volume ({Math.round(user.sfxVolume * 100)}%)
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={user.sfxVolume}
            onChange={(e) => void updateProfile({ sfxVolume: Number(e.target.value) })}
            className="w-full accent-cyan-400"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Reduced Motion</p>
            <p className="text-xs text-slate-400">Disable elaborate card flight and glow pulses</p>
          </div>
          <input
            type="checkbox"
            checked={user.reducedAnimations}
            onChange={(e) => void updateProfile({ reducedAnimations: e.target.checked })}
            className="w-5 h-5 accent-cyan-400"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Preferred Table Speed</label>
          <div className="grid grid-cols-3 gap-2">
            {(['relaxed', 'normal', 'fast'] as GameSpeed[]).map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => void updateProfile({ preferredSpeed: sp })}
                className={`btn-glossy py-2.5 rounded-full border text-xs font-semibold capitalize ${
                  user.preferredSpeed === sp
                    ? 'btn-glossy-blue border-cyan-300/60 text-white'
                    : 'btn-glossy-dark text-slate-400'
                }`}
              >
                {sp}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-300">Installable App (PWA)</p>
            <p className="text-[11px] text-slate-400">
              Backend Mode: {supabaseConfigured ? 'Supabase PostgreSQL & Auth' : 'Local Server-Authoritative Preview'}
            </p>
          </div>
          <PWAInstallButton />
        </div>

        <div className="pt-3 border-t border-slate-800 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void logout()}
            className="btn-glossy btn-glossy-dark inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold text-white"
          >
            <LogOut className="w-4 h-4" /> Log Out
          </button>

          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="btn-glossy btn-glossy-dark inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-rose-500/40 text-xs font-semibold text-rose-400"
            >
              <Trash2 className="w-4 h-4" /> Delete Account
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void deleteAccount()}
              className="btn-glossy btn-glossy-pink px-5 py-2.5 rounded-full text-xs font-bold text-white"
            >
              Confirm Permanent Deletion
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// 27. ADMIN DASHBOARD (Server-enforced admin permission)
export const AdminDashboardView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [data, setData] = useState<{
    players: Array<{ id: string; username: string; email: string; role: string; level: number; chipBalance: number; isSuspended: boolean }>;
    rooms: Array<{ id: string; code: string; name: string; playerCount: number; status: string }>;
    tournaments: Array<{ id: string; code: string; name: string; registeredCount: number; status: string }>;
    reports: Array<{ id: string; reporterUsername: string; reportedUsername: string; reason: string; status: string }>;
    recentTransactions: ChipTransaction[];
    logs: Array<{ id: string; level: string; category: string; message: string; createdAt: string }>;
    settings: { maintenanceMode: boolean; allowNewRegistrations: boolean };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await apiFetch<NonNullable<typeof data>>('/api/admin/overview');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Admin access denied');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleSuspend = async (id: string, suspended: boolean) => {
    await apiFetch(`/api/admin/players/${id}/suspend`, { method: 'POST', body: JSON.stringify({ suspended }) });
    await load();
  };

  const resolveReport = async (id: string, status: 'resolved' | 'dismissed') => {
    await apiFetch(`/api/admin/reports/${id}/resolve`, { method: 'POST', body: JSON.stringify({ status }) });
    await load();
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="w-10 h-10 rounded-xl border border-slate-800 bg-slate-900 flex items-center justify-center text-slate-200">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-display font-bold text-white flex items-center gap-2">
            <Crown className="w-5 h-5 text-amber-400" /> Admin Dashboard
          </h1>
          <p className="text-xs text-slate-400">Server-enforced moderation, integrity logs, and economy oversight</p>
        </div>
      </div>

      {error && <div className="rounded-xl bg-rose-500/15 border border-rose-500/40 p-4 text-sm text-rose-300">{error}</div>}

      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-800 bg-[#0b1020] p-4">
              <p className="text-xs text-slate-400">Registered Players</p>
              <p className="font-mono text-2xl font-bold text-white mt-1">{data.players.length}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0b1020] p-4">
              <p className="text-xs text-slate-400">Rooms</p>
              <p className="font-mono text-2xl font-bold text-cyan-300 mt-1">{data.rooms.length}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0b1020] p-4">
              <p className="text-xs text-slate-400">Tournaments</p>
              <p className="font-mono text-2xl font-bold text-amber-300 mt-1">{data.tournaments.length}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0b1020] p-4">
              <p className="text-xs text-slate-400">Open Reports</p>
              <p className="font-mono text-2xl font-bold text-rose-400 mt-1">
                {data.reports.filter((r) => r.status === 'open').length}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0b1020] p-4 space-y-3">
            <h2 className="text-sm font-display font-bold text-white">Players &amp; Moderation</h2>
            <div className="divide-y divide-slate-800/70">
              {data.players.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <p className="font-semibold text-white">
                      {p.username} <span className="text-slate-400">({p.email})</span> · {p.role}
                    </p>
                    <p className="font-mono text-amber-300">{p.chipBalance.toLocaleString()} chips</p>
                  </div>
                  {p.role !== 'admin' && (
                    <button
                      type="button"
                      onClick={() => void toggleSuspend(p.id, !p.isSuspended)}
                      className={`px-3 py-1.5 rounded-lg font-bold ${
                        p.isSuspended ? 'bg-emerald-500 text-slate-950' : 'bg-rose-600/20 text-rose-300 border border-rose-500/40'
                      }`}
                    >
                      {p.isSuspended ? 'Unsuspend' : 'Suspend'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0b1020] p-4 space-y-3">
            <h2 className="text-sm font-display font-bold text-white">Reported Players</h2>
            {data.reports.length === 0 ? (
              <p className="text-xs text-slate-500">No player reports.</p>
            ) : (
              data.reports.map((rep) => (
                <div key={rep.id} className="flex items-center justify-between gap-3 py-2 border-b border-slate-800/60 text-xs">
                  <div>
                    <p className="font-semibold text-white">
                      {rep.reportedUsername} <span className="text-slate-400">reported by {rep.reporterUsername}</span>
                    </p>
                    <p className="text-slate-300">{rep.reason} · Status: {rep.status}</p>
                  </div>
                  {rep.status === 'open' && (
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => void resolveReport(rep.id, 'resolved')} className="px-2.5 py-1 rounded bg-emerald-500 text-slate-950 font-bold">
                        Resolve
                      </button>
                      <button type="button" onClick={() => void resolveReport(rep.id, 'dismissed')} className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0b1020] p-4 space-y-2">
            <h2 className="text-sm font-display font-bold text-white">Server &amp; Integrity Logs</h2>
            <div className="max-h-48 overflow-y-auto space-y-1 font-mono text-[11px]">
              {data.logs.map((l) => (
                <div key={l.id} className="text-slate-300">
                  <span className="text-slate-500">[{new Date(l.createdAt).toLocaleTimeString()}]</span>{' '}
                  <span className={l.level === 'warn' || l.level === 'error' ? 'text-amber-300' : 'text-cyan-300'}>
                    [{l.category}]
                  </span>{' '}
                  {l.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
