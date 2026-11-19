import { describe, expect, it } from 'vitest';
import { createNeonPokerServer } from '../server.ts';

describe('new owner and club features preserve local-game security', () => {
  it('denies local session owner privileges and never grants false wheel credits', async () => {
    const { httpServer } = createNeonPokerServer();
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') throw Error('missing address');
    const base = `http://127.0.0.1:${addr.port}`;
    try {
      const register = await fetch(base + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'FeatureOwnerCheck',
          email: 'feature-owner@test.invalid',
          password: 'securetestpass123',
        }),
      });
      expect(register.status).toBe(201);
      const details = await register.json() as { token: string };
      const request = async (path: string, method = 'GET', body?: object) => {
        const r = await fetch(base + path, {
          method,
          headers: {
            Authorization: `Bearer ${details.token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: r.status, data: await r.json() as any };
      };
      const before = await request('/api/wallet');
      const owner = await request('/api/owner/status');
      expect(owner.status).toBe(200);
      expect(owner.data.isOwner).toBe(false);
      expect((await request('/api/owner/metrics')).status).toBe(403);
      expect((await request('/api/wheel/status')).status).toBe(503);
      expect((await request('/api/wheel/spin', 'POST')).status).toBe(503);
      expect((await request('/api/clubs/presets')).status).toBe(503);
      const after = await request('/api/wallet');
      expect(after.data.wallet.chipBalance).toBe(before.data.wallet.chipBalance);
      const health = await request('/api/health');
      expect(health.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => error ? reject(error) : resolve()));
    }
  });
});
