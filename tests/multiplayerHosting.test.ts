import { describe, expect, it } from 'vitest';
import { createNeonPokerServer } from '../server.ts';

async function startServer(statelessRuntime: boolean) {
  const srv = createNeonPokerServer({ statelessRuntime });
  await new Promise<void>(resolve => srv.httpServer.listen(0, '127.0.0.1', resolve));
  const address = srv.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Test server not listening');
  const base = 'http://127.0.0.1:' + address.port;
  const request = async (path: string, method = 'GET', token?: string, body?: object) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const register = async (email: string, username: string) => {
    const response = await request('/api/auth/register', 'POST', undefined,
      { email, username, password: 'demo_password_1234' });
    expect(response.status).toBe(201);
    return response.body as { token: string; user: { id: string }; wallet: { chipBalance: number } };
  };
  return { ...srv, request, register, close: async () => {
    srv.gameManager.cleanup();
    await new Promise<void>((resolve, reject) =>
      srv.httpServer.close(err => err ? reject(err) : resolve()));
  } };
}

describe('hosted multiplayer reliability', () => {
  it('starts without any pre-created poker or blackjack tables', () => {
    const first = createNeonPokerServer();
    const restarted = createNeonPokerServer();
    try {
      expect(first.gameManager.rooms.size).toBe(0);
      expect(restarted.gameManager.rooms.size).toBe(0);
      expect(first.gameManager.roomCodeToId.size).toBe(0);
      expect(restarted.gameManager.roomCodeToId.size).toBe(0);
    } finally {
      first.gameManager.cleanup();
      restarted.gameManager.cleanup();
    }
  });

  it('never advertises Vercel serverless rooms that cannot be reliably joined', async () => {
    const server = await startServer(true);
    try {
      const health = await server.request('/api/health');
      expect(health.body.multiplayerAvailable).toBe(false);
      const player = await server.register('stability-off@test.example', 'StabilityOff');
      const listed = await server.request('/api/rooms', 'GET', player.token);
      expect(listed.status).toBe(200);
      expect(listed.body.rooms).toEqual([]);
      expect(listed.body.multiplayerAvailable).toBe(false);
      const joined = await server.request('/api/rooms/join', 'POST', player.token,
        { roomIdOrCode: 'MIDN50', buyinAmount: 1000 });
      expect(joined.status).toBe(503);
      expect(joined.body.code).toBe('GAME_SERVER_REQUIRED');
      const created = await server.request('/api/rooms', 'POST', player.token,
        { name: 'Should Not Charge', gameType: 'holdem', visibility: 'public', maxPlayers: 2 });
      expect(created.status).toBe(503);
      const blackjack = await server.request('/api/rooms/join', 'POST', player.token,
        { roomIdOrCode: 'VIP21X', buyinAmount: 1000 });
      expect(blackjack.status).toBe(503);
      const tournaments = await server.request('/api/tournaments', 'GET', player.token);
      expect(tournaments.status).toBe(200);
      expect(tournaments.body.tournaments).toEqual([]);
      const session = await server.request('/api/auth/session', 'GET', player.token);
      expect(session.body.wallet.chipBalance).toBe(5000);
    } finally {
      await server.close();
    }
  });

  it('creates and joins on-demand Holdem and Blackjack tables, then removes them when empty', async () => {
    const server = await startServer(false);
    try {
      const alice = await server.register('stability-alice@test.example', 'StabilityAlice');
      const bob = await server.register('stability-bob@test.example', 'StabilityBob');
      expect((await server.request('/api/rooms', 'GET', alice.token)).body.rooms).toHaveLength(0);

      for (const gameType of ['holdem', 'blackjack'] as const) {
        const creator = gameType === 'holdem' ? alice : bob;
        const guest = gameType === 'holdem' ? bob : alice;
        const created = await server.request('/api/rooms', 'POST', creator.token, {
          name: 'Friends ' + gameType,
          gameType,
          visibility: 'public',
          maxPlayers: 4,
          minBuyin: 500,
          maxBuyin: 5000,
          buyinAmount: 1000,
        });
        expect(created.status).toBe(201);
        expect(created.body.room.playerCount).toBe(1);
        const roomId = created.body.room.id;
        const publicList = await server.request('/api/rooms', 'GET', guest.token);
        expect(publicList.body.rooms.some((r: { id: string }) => r.id === roomId)).toBe(true);
        const joined = await server.request('/api/rooms/join', 'POST', guest.token, {
          roomIdOrCode: created.body.room.code,
          buyinAmount: 1000,
        });
        expect(joined.status).toBe(200);
        expect(joined.body.room.id).toBe(roomId);
        expect(joined.body.room.playerCount).toBe(2);
        expect((await server.request('/api/rooms/' + roomId, 'GET', guest.token)).status).toBe(200);

        expect((await server.request('/api/rooms/' + roomId + '/leave', 'POST', guest.token)).status).toBe(200);
        expect((await server.request('/api/rooms/' + roomId + '/leave', 'POST', creator.token)).status).toBe(200);
        expect((await server.request('/api/rooms/' + roomId, 'GET', guest.token)).status).toBe(404);
        expect((await server.request('/api/rooms', 'GET', alice.token)).body.rooms).toHaveLength(0);
        expect(server.gameManager.roomCodeToId.has(created.body.room.code)).toBe(false);
      }

      const failed = await server.request('/api/rooms', 'POST', alice.token, {
        name: 'Unfunded Ghost Table',
        gameType: 'holdem',
        visibility: 'public',
        maxPlayers: 2,
        minBuyin: 999999,
        maxBuyin: 999999,
        buyinAmount: 999999,
      });
      expect(failed.status).toBe(400);
      expect((await server.request('/api/rooms', 'GET', alice.token)).body.rooms).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

});
