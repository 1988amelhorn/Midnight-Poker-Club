import { describe, expect, it } from 'vitest';
import { createNeonPokerServer } from '../server.ts';

describe('game continuity and player public profiles', () => {
  it('does not erase active poker and blackjack cards on repeated Start', async () => {
    const { httpServer } = createNeonPokerServer();
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const base = `http://127.0.0.1:${address.port}`;
    const call = async (path: string, token?: string, method = 'GET', body?: object) => {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json() as any };
    };
    try {
      const a = await call('/api/auth/register', undefined, 'POST',
        { email: 'repeat-a@game.test', password: 'password123', username: 'RepeatA' });
      const b = await call('/api/auth/register', undefined, 'POST',
        { email: 'repeat-b@game.test', password: 'password123', username: 'RepeatB' });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      const token = a.body.token as string;
      const t2 = b.body.token as string;
      const poker = await call('/api/rooms', token, 'POST',
        { name: 'Repeat Start Poker', gameType: 'holdem', visibility: 'public', maxPlayers: 2, buyinAmount: 500 });
      expect(poker.status).toBe(201);
      const room = poker.body.room.id as string;
      const joined = await call('/api/rooms/join', t2, 'POST', { roomIdOrCode: room, buyinAmount: 500 });
      expect(joined.status).toBe(200);
      expect((await call(`/api/rooms/${room}/start`, token, 'POST')).status).toBe(200);
      const before = (await call(`/api/rooms/${room}`, token)).body.poker;
      expect(before.handNumber).toBe(1);
      expect(before.street).toBe('preflop');
      expect((await call(`/api/rooms/${room}/start`, token, 'POST')).status).toBe(200);
      const after = (await call(`/api/rooms/${room}`, token)).body.poker;
      expect(after.handNumber).toBe(before.handNumber);
      expect(after.seats).toEqual(before.seats);
      expect(after.communityCards).toEqual(before.communityCards);

      const user = await call(`/api/players/${a.body.user.id}/profile`, t2);
      expect(user.status).toBe(200);
      expect(user.body.profile.username).toBe('RepeatA');
      expect(user.body.stats.pokerHandsPlayed).toBeTypeOf('number');
      expect(user.body.profile).not.toHaveProperty('email');
      expect(user.body.profile).not.toHaveProperty('role');
      expect(user.body).not.toHaveProperty('wallet');
      const friend = await call('/api/friends/request', t2, 'POST', { receiverId: a.body.user.id });
      expect(friend.status).toBe(201);
      const afterRequest = await call(`/api/players/${a.body.user.id}/profile`, t2);
      expect(afterRequest.body.friendRequestPending).toBe(true);
      
      const blackjack = await call('/api/rooms', token, 'POST',
        { name: 'Repeat Start Blackjack', gameType: 'blackjack', visibility: 'private',
          maxPlayers: 1, buyinAmount: 500 });
      expect(blackjack.status).toBe(201);
      const bjId = blackjack.body.room.id as string;
      expect((await call(`/api/rooms/${bjId}/start`, token, 'POST')).status).toBe(200);
      const wager = await call(`/api/rooms/${bjId}/blackjack/action`, token, 'POST',
        { action: 'place_bet', amount: 100 });
      expect(wager.status).toBe(200);
      const bjBefore = (await call(`/api/rooms/${bjId}`, token)).body.blackjack;
      expect((await call(`/api/rooms/${bjId}/start`, token, 'POST')).status).toBe(200);
      const bjAfter = (await call(`/api/rooms/${bjId}`, token)).body.blackjack;
      expect(bjAfter.roundNumber).toBe(bjBefore.roundNumber);
      expect(bjAfter.seats).toEqual(bjBefore.seats);
      expect(bjAfter.dealerCards).toEqual(bjBefore.dealerCards);
    } finally {
      await new Promise<void>((resolve, reject) => httpServer.close(err => err ? reject(err) : resolve()));
    }
  });
});
