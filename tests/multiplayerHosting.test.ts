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
  it('retains stable public table IDs after a game server restart', () => {
    const first = createNeonPokerServer();
    const restarted = createNeonPokerServer();
    try {
      const house = ['MIDN50', 'CYBR20', 'VIP21X'];
      for (const code of house) {
        const original = first.gameManager.roomCodeToId.get(code);
        const replacement = restarted.gameManager.roomCodeToId.get(code);
        expect(original).toBeTruthy();
        expect(replacement).toBe(original);
      }
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

  it('joins both official Holdem and Blackjack tables on a single game process', async () => {
    const server = await startServer(false);
    try {
      const alice = await server.register('stability-alice@test.example', 'StabilityAlice');
      const bob = await server.register('stability-bob@test.example', 'StabilityBob');
      const listed = await server.request('/api/rooms', 'GET', alice.token);
      expect(listed.status).toBe(200);
      expect(listed.body.rooms).toHaveLength(3);
      for (const gameType of ['holdem', 'blackjack']) {
        const room = listed.body.rooms.find((r: {gameType: string}) => r.gameType === gameType);
        expect(room).toBeTruthy();
        const joined = await server.request('/api/rooms/join', 'POST',
          gameType === 'holdem' ? alice.token : bob.token,
          { roomIdOrCode: room.id, buyinAmount: 1000 });
        expect(joined.status).toBe(200);
        expect(joined.body.room.id).toBe(room.id);
        const view = await server.request('/api/rooms/' + room.id, 'GET',
          gameType === 'holdem' ? alice.token : bob.token);
        expect(view.status).toBe(200);
        expect(view.body.room.playerCount).toBe(1);
      }
    } finally {
      await server.close();
    }
  });
});
