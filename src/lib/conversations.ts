import type { ChatMessageItem, FriendItem } from '../shared/types.ts';

interface Conversation {
  userId: string;
  username: string;
  avatarId: string;
  latest?: ChatMessageItem;
}

function belongsToUser(userId: string, message: ChatMessageItem) {
  return message.channelType === 'direct' && !!message.recipientId &&
    (message.senderId === userId || message.recipientId === userId);
}

export function buildConversations(userId: string | undefined, friends: FriendItem[], messages: ChatMessageItem[]): Conversation[] {
  if (!userId) return [];
  const peers = new Map<string, Conversation>();
  for (const friend of friends) {
    if (friend.userId !== userId) peers.set(friend.userId, { ...friend });
  }
  for (const message of messages) {
    if (!belongsToUser(userId, message)) continue;
    const sent = message.senderId === userId;
    const peerId = sent ? message.recipientId! : message.senderId;
    const existing = peers.get(peerId);
    peers.set(peerId, {
      userId: peerId,
      username: existing?.username || (sent ? message.recipientUsername : message.senderUsername) || 'Player',
      avatarId: existing?.avatarId || (sent ? message.recipientAvatarId : message.senderAvatarId) || 'ace-spade',
      latest: !existing?.latest || Date.parse(message.createdAt) >= Date.parse(existing.latest.createdAt) ? message : existing.latest,
    });
  }
  return [...peers.values()].sort((a, b) =>
    (Date.parse(b.latest?.createdAt || '') || 0) - (Date.parse(a.latest?.createdAt || '') || 0) || a.username.localeCompare(b.username));
}

export function getConversationMessages(userId: string | undefined, peerId: string | null, messages: ChatMessageItem[]): ChatMessageItem[] {
  if (!userId || !peerId) return [];
  return messages.filter(message => belongsToUser(userId, message) && (
    (message.senderId === peerId && message.recipientId === userId) ||
    (message.senderId === userId && message.recipientId === peerId)
  )).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
