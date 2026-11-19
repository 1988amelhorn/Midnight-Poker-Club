import React, { useEffect, useState } from 'react';
import { X, UserPlus, UserCheck, Trophy } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { PlayerStatistics } from '../shared/types.ts';
import { PlayerAvatar } from '../utils/avatars.tsx';

type PublicPlayer = {
  id: string; username: string; avatarId: string; level: number;
  xp: number; bio: string; createdAt: string;
};
type PublicPlayerResponse = {
  profile: PublicPlayer;
  stats: PlayerStatistics;
  isFriend: boolean;
  isSelf: boolean;
  friendRequestPending: boolean;
};

/** Modal accessible from any non-bot player's avatar. Read-only profile data. */
export const PlayerCardModal: React.FC<{
  playerId: string;
  onClose: () => void;
}> = ({ playerId, onClose }) => {
  const [data, setData] = useState<PublicPlayerResponse | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    void apiFetch<PublicPlayerResponse>(`/api/players/${encodeURIComponent(playerId)}/profile`)
      .then((response) => { if (active) setData(response); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Unable to load profile'); });
    return () => { active = false; };
  }, [playerId]);

  const requestFriend = async () => {
    if (!data || sending || data.isFriend || data.friendRequestPending) return;
    setSending(true);
    try {
      await apiFetch('/api/friends/request', {
        method: 'POST',
        body: JSON.stringify({ receiverId: data.profile.id }),
      });
      setData((current) => current ? { ...current, friendRequestPending: true } : current);
      setNotice('Friend request sent!');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not send friend request');
    } finally {
      setSending(false);
    }
  };

  const statRows = data ? [
    ['Poker hands', data.stats.pokerHandsPlayed],
    ['Poker wins', data.stats.pokerHandsWon],
    ['Poker win rate', data.stats.pokerHandsPlayed ? `${Math.round(100 * data.stats.pokerHandsWon / data.stats.pokerHandsPlayed)}%` : '—'],
    ['Blackjack hands', data.stats.blackjackHandsPlayed],
    ['Blackjack wins', data.stats.blackjackHandsWon],
    ['Blackjacks', data.stats.blackjackBlackjacks],
    ['Tournaments played', data.stats.tournamentsPlayed],
    ['Tournaments won', data.stats.tournamentsWon],
    ['Total games', data.stats.totalGamesPlayed],
  ] : [];

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-3 sm:p-5" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Player profile" className="glass-bubbly relative max-h-[90dvh] overflow-y-auto rounded-[30px] w-full max-w-md border border-sky-400/30 p-5 sm:p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Close profile" className="absolute right-4 top-4 rounded-full p-2 bg-slate-800 text-white"><X className="h-4 w-4" /></button>
        {error && <p role="alert" className="text-rose-300 text-sm py-8">{error}</p>}
        {!data && !error && <p className="text-center py-10 text-slate-300">Loading player profile…</p>}
        {data && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 pr-8">
              <PlayerAvatar avatarId={data.profile.avatarId} username={data.profile.username} size="lg" />
              <div>
                <h2 className="font-display font-extrabold text-xl text-white">{data.profile.username}</h2>
                <p className="text-cyan-300 text-sm">Level {data.profile.level} · {data.profile.xp} XP</p>
                <p className="text-slate-400 text-xs">Member since {new Date(data.profile.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
            {data.profile.bio && <p className="text-slate-300 text-sm">{data.profile.bio}</p>}
            <h3 className="flex items-center gap-2 font-bold text-amber-300"><Trophy className="h-4 w-4" /> Player Stats</h3>
            <div className="grid grid-cols-2 gap-2">
              {statRows.map(([name, value]) => (
                <div key={name} className="bg-slate-900/70 border border-slate-700/50 rounded-xl px-3 py-2">
                  <div className="text-xs text-slate-400">{name}</div>
                  <div className="font-extrabold text-white">{value}</div>
                </div>
              ))}
            </div>
            {!data.isSelf && (
              <button type="button" disabled={data.isFriend || data.friendRequestPending || sending} onClick={() => void requestFriend()} className="btn-glossy btn-glossy-blue w-full px-5 py-3 rounded-full text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-65">
                {data.isFriend ? <><UserCheck className="h-4 w-4" /> Already friends</> :
                  data.friendRequestPending ? 'Friend request pending' :
                  <><UserPlus className="h-4 w-4" /> {sending ? 'Sending…' : 'Add Friend'}</>}
              </button>
            )}
            {notice && <p className="text-center text-sm text-cyan-300">{notice}</p>}
          </div>
        )}
      </div>
    </div>
  );
};
