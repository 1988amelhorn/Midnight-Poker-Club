import { describe, expect, it } from 'vitest';
import { createNeonPokerServer } from '../server.ts';

describe('direct-message threads and privacy', () => {
  it('keeps each conversation private and identifies sender and recipient', async () => {
    const { httpServer } = createNeonPokerServer();
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Unable to start test server');
    const base = 'http://127.0.0.1:' + address.port;
    const call = async (path: string, token?: string, method = 'GET', body?: object) => {
      const result = await fetch(base + path, {
        method,
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: result.status, body: await result.json() as any };
    };
    try {
      const register = async (email: string, username: string) => {
        const result = await call('/api/auth/register', undefined, 'POST',
          { email, username, password: 'long-test-password-123' });
        expect(result.status).toBe(201);
        return result.body as { token: string; user: { id: string } };
      };
      const alice = await register('alice@threads.test', 'ThreadsAlice');
      const bob = await register('bob@threads.test', 'ThreadsBob');
      const stranger = await register('stranger@threads.test', 'ThreadStranger');
      const payload = { channelType:'direct', channelId:bob.user.id, recipientId:bob.user.id, message:'Hello Bob' };
      expect((await call('/api/chat', alice.token, 'POST', payload)).status).toBe(403);
      const request = await call('/api/friends/request', alice.token, 'POST', { receiverId: bob.user.id });
      expect(request.status).toBe(201);
      const accepted = await call('/api/friends/requests/' + request.body.request.id + '/respond',
        bob.token, 'POST', { accept: true });
      expect(accepted.status).toBe(200);
      const sent = await call('/api/chat', alice.token, 'POST', payload);
      expect(sent.status).toBe(201);
      expect(sent.body.item.recipientId).toBe(bob.user.id);
      expect(sent.body.item.senderUsername).toBe('ThreadsAlice');
      expect((await call('/api/chat', bob.token, 'POST', {
        channelType:'direct', channelId:alice.user.id, recipientId:alice.user.id, message:'Hi Alice',
      })).status).toBe(201);
      const inboxAlice = await call('/api/inbox', alice.token);
      const inboxBob = await call('/api/inbox', bob.token);
      const inboxStranger = await call('/api/inbox', stranger.token);
      expect(inboxAlice.status).toBe(200);
      expect(inboxBob.status).toBe(200);
      expect(inboxAlice.body.directMessages).toHaveLength(2);
      expect(inboxBob.body.directMessages).toHaveLength(2);
      expect(inboxStranger.body.directMessages).toHaveLength(0);
      expect(inboxBob.body.directMessages[0].message).toBe('Hello Bob');
      expect(inboxBob.body.directMessages[1].message).toBe('Hi Alice');
    } finally {
      await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
    }
  });
});
