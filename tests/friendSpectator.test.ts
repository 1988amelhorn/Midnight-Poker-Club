import { describe, expect, it } from 'vitest';
import { createNeonPokerServer } from '../server.ts';

describe('accepted-friend read-only spectating', () => {
  it('protects private games and hidden cards while allowing a friend to watch', async () => {
    const { httpServer } = createNeonPokerServer();
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const base = `http://127.0.0.1:${address.port}`;
    const req = async (path: string, method = 'GET', token?: string, body?: object) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, json: await response.json() as any };
    };
    try {
      const register = async (email: string, username: string) => {
        const r = await req('/api/auth/register', 'POST', undefined,
          { email, username, password: 'secret_password_123' });
        expect(r.status).toBe(201);
        return r.json as { token: string; user: { id: string } };
      };
      const host = await register('specthost@test.example', 'SpectHost');
      const guest = await register('spectguest@test.example', 'SpectGuest');
      const stranger = await register('spectstranger@test.example', 'SpectStranger');
      const create = await req('/api/rooms', 'POST', host.token,
        { name: 'Private Watch Table', gameType: 'holdem', visibility: 'private',
          maxPlayers: 2, buyinAmount: 500, initialBots: 1 });
      expect(create.status).toBe(201);
      const roomId = create.json.room.id as string;
      const url = `/api/rooms/${roomId}/spectate?friendId=${host.user.id}`;
      expect((await req(url, 'GET', stranger.token)).status).toBe(403);
      expect((await req(url, 'GET', guest.token)).status).toBe(403);
      const friendReq = await req('/api/friends/request', 'POST', host.token,
        { receiverId: guest.user.id });
      expect(friendReq.status).toBe(201);
      const accepted = await req(`/api/friends/requests/${friendReq.json.request.id}/respond`,
        'POST', guest.token, { accept: true });
      expect(accepted.status).toBe(200);
      const watch = await req(url, 'GET', guest.token);
      expect(watch.status).toBe(200);
      expect(watch.json.room.code).toBe('');
      expect(watch.json.poker?.legalActions).toBeNull();
      expect(watch.json.poker?.handStrength).toBeNull();
      expect(watch.json.poker?.seats.every((s: any) => s.holeCards === null)).toBe(true);
      const guestSession = await req('/api/auth/session', 'GET', guest.token);
      expect(guestSession.json.activeRoom).toBeNull();
      await req(`/api/rooms/${roomId}/leave`, 'POST', host.token);
      expect((await req(url, 'GET', guest.token)).status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
    }
  });
});
