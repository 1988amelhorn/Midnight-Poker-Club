import { describe, expect, it } from 'vitest';
import { buildConversations, getConversationMessages } from '../src/lib/conversations.ts';
import type { ChatMessageItem } from '../src/shared/types.ts';

const message = (id: string, senderId: string, recipientId: string, createdAt: string): ChatMessageItem => ({
  id, senderId, recipientId, createdAt, channelType: 'direct', channelId: recipientId,
  senderUsername: senderId, recipientUsername: recipientId, senderAvatarId: 'ace-spade', message: id, isEmote: false,
});
const messages = [
  message('bob-reply', 'bob', 'me', '2026-11-21T02:00:00Z'),
  message('carol-chat', 'me', 'carol', '2026-11-21T03:00:00Z'),
  message('bob-first', 'me', 'bob', '2026-11-21T01:00:00Z'),
  message('unrelated', 'bob', 'carol', '2026-11-21T04:00:00Z'),
];
describe('individual conversations', () => {
  it('groups sent and received messages in one row per person, newest conversation first', () => {
    const rows = buildConversations('me', [], messages);
    expect(rows.map(row => row.userId)).toEqual(['carol', 'bob']);
    expect(rows.map(row => row.latest?.id)).toEqual(['carol-chat', 'bob-reply']);
  });
  it('opens only the selected pair of people in chronological order', () => {
    expect(getConversationMessages('me', 'bob', messages).map(m => m.id)).toEqual(['bob-first', 'bob-reply']);
    expect(getConversationMessages('me', 'carol', messages).map(m => m.id)).toEqual(['carol-chat']);
    expect(getConversationMessages('me', null, messages)).toEqual([]);
  });
  it('does not turn table chat or incomplete messages into private conversations', () => {
    const invalid = [ { ...messages[0], channelType: 'room' as const }, { ...messages[0], recipientId: undefined } ];
    expect(buildConversations('me', [], invalid)).toEqual([]);
    expect(getConversationMessages('me', 'bob', invalid)).toEqual([]);
    expect(buildConversations(undefined, [], messages)).toEqual([]);
  });
});
