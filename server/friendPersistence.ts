import type { SupabaseClient } from '@supabase/supabase-js';
import type { FriendItem, FriendRequestItem } from '../src/shared/types.ts';
import type { ServerDataStore } from './dataStore.ts';

type Profile = { uid: string; username: string; avatar_url: string | null; is_online: boolean | null };
type RequestRow = {
  id: string; from_uid: string; to_uid: string;
  status: 'pending' | 'accepted' | 'rejected'; created_at: string;
};

export class FriendsDatabaseError extends Error {
  constructor(message: string) { super(message); }
}

function ensureSuccess(error: { message: string } | null, operation: string): void {
  if (error) throw new FriendsDatabaseError(`${operation}: ${error.message}`);
}

async function loadProfiles(db: SupabaseClient, ids: string[]): Promise<Map<string, Profile>> {
  const profiles = new Map<string, Profile>();
  if (!ids.length) return profiles;
  const { data, error } = await db
    .from('profiles')
    .select('uid, username, avatar_url, is_online')
    .in('uid', [...new Set(ids)]);
  ensureSuccess(error, 'Unable to load players');
  for (const row of (data || []) as Profile[]) profiles.set(row.uid, row);
  return profiles;
}

function toRequest(row: RequestRow, profiles: Map<string, Profile>): FriendRequestItem {
  return {
    id: row.id,
    senderId: row.from_uid,
    senderUsername: profiles.get(row.from_uid)?.username || 'Player',
    senderAvatarId: profiles.get(row.from_uid)?.avatar_url || 'ace-spade',
    receiverId: row.to_uid,
    receiverUsername: profiles.get(row.to_uid)?.username || 'Player',
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function listPersistentFriends(
  db: SupabaseClient,
  uid: string,
  dataStore: ServerDataStore
): Promise<{ friends: FriendItem[]; incomingRequests: FriendRequestItem[]; outgoingRequests: FriendRequestItem[] }> {
  const [links, requests] = await Promise.all([
    db.from('friends').select('friend_uid').eq('uid', uid),
    db.from('friend_requests')
      .select('id,from_uid,to_uid,status,created_at')
      .eq('status', 'pending')
      .or(`from_uid.eq.${uid},to_uid.eq.${uid}`),
  ]);
  ensureSuccess(links.error, 'Unable to load friends');
  ensureSuccess(requests.error, 'Unable to load requests');
  const rows = (requests.data || []) as RequestRow[];
  const friendIds = (links.data || []).map((row) => row.friend_uid as string);
  const profiles = await loadProfiles(db, [uid, ...friendIds, ...rows.flatMap((r) => [r.from_uid, r.to_uid])]);
  const friends: FriendItem[] = friendIds.flatMap((id) => {
    const player = profiles.get(id);
    if (!player) return [];
    const presence = dataStore.onlineUsers.get(id);
    return [{
      userId: id,
      username: player.username,
      avatarId: player.avatar_url || 'ace-spade',
      level: dataStore.users.get(id)?.profile.level || 1,
      // Persisted online flags can be stale; only show online for a recent ping.
      online: Boolean(presence && Date.now() - presence.lastPing < 60_000),
      currentRoomId: presence?.roomId ?? null,
      currentRoomName: presence?.roomName ?? null,
    }];
  });
  return {
    friends,
    incomingRequests: rows.filter((r) => r.to_uid === uid).map((r) => toRequest(r, profiles)),
    outgoingRequests: rows.filter((r) => r.from_uid === uid).map((r) => toRequest(r, profiles)),
  };
}

export async function sendPersistentFriendRequest(
  db: SupabaseClient, uid: string, receiverId: string
): Promise<{ ok: boolean; request?: FriendRequestItem; error?: string }> {
  if (uid === receiverId) return { ok: false, error: 'Cannot friend yourself' };
  if (!/^[0-9a-f-]{36}$/i.test(receiverId)) return { ok: false, error: 'Invalid player' };
  const profiles = await loadProfiles(db, [uid, receiverId]);
  if (!profiles.has(receiverId)) return { ok: false, error: 'Player not found' };
  const { data: linked, error: linkError } = await db
    .from('friends').select('friend_uid').eq('uid', uid).eq('friend_uid', receiverId).maybeSingle();
  ensureSuccess(linkError, 'Unable to check friends');
  if (linked) return { ok: false, error: 'Already friends' };
  const { data: existing, error: pendingError } = await db
    .from('friend_requests').select('id,from_uid,to_uid')
    .eq('status', 'pending')
    .in('from_uid', [uid, receiverId]).in('to_uid', [uid, receiverId]);
  ensureSuccess(pendingError, 'Unable to check pending requests');
  if (existing?.length) return { ok: false, error: 'Friend request already pending' };
  const { data, error } = await db
    .from('friend_requests').insert({ from_uid: uid, to_uid: receiverId, status: 'pending' })
    .select('id,from_uid,to_uid,status,created_at').single();
  if (error?.code === '23505') return { ok: false, error: 'Friend request already pending' };
  ensureSuccess(error, 'Could not send friend request');
  return { ok: true, request: toRequest(data as RequestRow, profiles) };
}

export async function respondPersistentFriendRequest(
  db: SupabaseClient, uid: string, id: string, accept: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'Invalid friend request' };
  const { data, error } = await db
    .from('friend_requests')
    .update({ status: accept ? 'accepted' : 'rejected', updated_at: new Date().toISOString() })
    .eq('id', id).eq('to_uid', uid).eq('status', 'pending')
    .select('id').maybeSingle();
  ensureSuccess(error, 'Could not respond to friend request');
  return data ? { ok: true } : { ok: false, error: 'Request not found or already handled' };
}

export async function removePersistentFriend(
  db: SupabaseClient, uid: string, friendId: string
): Promise<void> {
  const { error } = await db.from('friends').delete().eq('uid', uid).eq('friend_uid', friendId);
  ensureSuccess(error, 'Could not remove friend');
}

export async function arePersistentFriends(
  db: SupabaseClient, uid: string, friendId: string
): Promise<boolean> {
  const { data, error } = await db.from('friends').select('friend_uid')
    .eq('uid', uid).eq('friend_uid', friendId).maybeSingle();
  ensureSuccess(error, 'Could not check friendship');
  return Boolean(data);
}
