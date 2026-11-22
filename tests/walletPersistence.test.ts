import { describe, expect, it, vi } from 'vitest';
import { claimSavedDailyBonus, signWalletEvent, WalletWriteQueue } from '../server/walletPersistence.ts';
import { createHmac } from 'node:crypto';
import { ServerDataStore } from '../server/dataStore.ts';
import { GameManager } from '../server/gameManager.ts';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('saved virtual-chip balances', () => {
  it('recovers a pending payout from disk after a process restart using the original nonce', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'midnight-wallet-'));
    const file = join(directory, 'outbox.json');
    try {
      const first = new WalletWriteQueue(file, () => new Promise<number>(() => {}));
      void first.enqueue({ uid: 'player', op: 'settle', room: 'table', amount: 2575, process: 'previous-process' });
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      expect(saved).toHaveLength(1);
      const send = vi.fn(async () => 2575);
      const restarted = new WalletWriteQueue(file, send);
      await restarted.flush('player');
      expect(send).toHaveBeenCalledExactlyOnceWith(saved[0]);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('does not send a wallet operation when its durable save fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'midnight-wallet-'));
    const send = vi.fn(async () => 2575);
    try {
      const queue = new WalletWriteQueue(join(directory, 'missing', 'outbox.json'), send);
      expect(() => queue.enqueue({ uid: 'player', op: 'settle', amount: 2575, process: 'test' })).toThrow();
      expect(send).not.toHaveBeenCalled();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('keeps the same payout queued if saving its acknowledgement fails', async () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'midnight-wallet-'));
    const file = join(directory, 'outbox.json');
    const nonces: string[] = [];
    try {
      const queue = new WalletWriteQueue(file, async event => {
        nonces.push(event.nonce);
        if (nonces.length === 1) rmSync(directory, { recursive: true, force: true });
        return 2575;
      });
      const saved = queue.enqueue({ uid: 'player', op: 'settle', amount: 2575, process: 'test' });
      await vi.advanceTimersByTimeAsync(0);
      mkdirSync(directory);
      await vi.advanceTimersByTimeAsync(500);
      await saved;
      expect(nonces).toHaveLength(2);
      expect(nonces[0]).toBe(nonces[1]);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([]);
    } finally {
      vi.useRealTimers();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('never confirms a bonus when the database write failed', async () => {
    await expect(claimSavedDailyBonus({ rpc: async () => ({ data: null, error: { message: 'offline' } }) })).rejects.toThrow('could not be saved');
    const result = await claimSavedDailyBonus({ rpc: async () => ({ error: null, data: [{ claimed: true, new_balance: 4000, available_balance: 3000, next_claim_at: '2026-11-22T03:00:00Z', streak: 1 }] }) });
    expect(result).toMatchObject({ claimed: true, newBalance: 4000, availableBalance: 3000, streak: 1 });
    const duplicate = await claimSavedDailyBonus({ rpc: async () => ({ error: null, data: [{ claimed: false, new_balance: 4000, available_balance: 3000, next_claim_at: '2026-11-22T03:00:00Z', streak: 1 }] }) });
    expect(duplicate.claimed).toBe(false);
  });

  it('retries the same signed event before sending a cashout', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    let fail = true;
    const queue = new WalletWriteQueue(null, async event => {
      seen.push(event.nonce);
      if (fail) { fail = false; throw new Error('network response lost'); }
      return 4000;
    });
    try {
      const a = queue.enqueue({ uid: 'player', op: 'settle', amount: 1250, process: 'test', room: 'table' });
      const b = queue.enqueue({ uid: 'player', op: 'cashout', amount: 1250, process: 'test', room: 'table' });
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.all([a, b]);
      expect(seen).toHaveLength(3);
      expect(seen[0]).toBe(seen[1]);
      expect(seen[2]).not.toBe(seen[1]);
      const signed = signWalletEvent({ uid: 'player', op: 'settle', amount: 1250, process: 'test', nonce: seen[0] }, 'test-secret', 123);
      expect(signed.p_signature).toBe(createHmac('sha256', 'test-secret').update(signed.p_payload).digest('hex'));
    } finally { vi.useRealTimers(); }
  });

  it('saves both poker winner and loser stacks before notifying their wallets', async () => {
    const store = new ServerDataStore();
    const gm = new GameManager(store);
    const alice = store.registerLocalUser({ email: 'walleta@test.invalid', password: 'secure123', username: 'WalletAlice' }).user!;
    const bob = store.registerLocalUser({ email: 'walletb@test.invalid', password: 'secure123', username: 'WalletBob' }).user!;
    let saved!: () => void;
    const settled = vi.spyOn(store, 'settleTableWallet').mockImplementation(() => new Promise<void>(resolve => { saved = resolve; }));
    const notify = vi.spyOn(gm, 'notifyUser');
    try {
      const created = gm.createRoom({ hostId: alice.profile.id, name: 'Wallet test', gameType: 'holdem', visibility: 'private', maxPlayers: 2, smallBlind: 25, bigBlind: 50, minBuyin: 500, maxBuyin: 2000 });
      const id = created.room!.id;
      gm.joinRoom({ userId: alice.profile.id, roomIdOrCode: id, buyinAmount: 1000 });
      gm.joinRoom({ userId: bob.profile.id, roomIdOrCode: id, buyinAmount: 1000 });
      gm.startRoomGame(alice.profile.id, id);
      const engine = gm.rooms.get(id)!.pokerEngine!;
      engine.applyAction(engine.currentTurnUserId!, 'fold');
      expect(settled).toHaveBeenCalledTimes(2);
      for (const seat of engine.seats) expect(settled).toHaveBeenCalledWith(seat.userId, id, seat.chips, 'poker_hand');
      expect(notify).not.toHaveBeenCalledWith(expect.anything(), { type: 'wallet:refresh' });
      saved();
      await Promise.resolve();
      expect(notify).toHaveBeenCalledWith(expect.anything(), { type: 'wallet:refresh' });
    } finally { gm.cleanup(); }
  });

  it('saves a winning blackjack stack and refreshes its wallet', async () => {
    const store = new ServerDataStore();
    const gm = new GameManager(store);
    const alice = store.registerLocalUser({ email: 'walletbj@test.invalid', password: 'secure123', username: 'WalletBJ' }).user!;
    const settled = vi.spyOn(store, 'settleTableWallet').mockResolvedValue();
    const notify = vi.spyOn(gm, 'notifyUser');
    try {
      const created = gm.createRoom({ hostId: alice.profile.id, name: 'Wallet blackjack', gameType: 'blackjack', visibility: 'private', maxPlayers: 2, smallBlind: 25, bigBlind: 50, minBuyin: 500, maxBuyin: 2000 });
      const id = created.room!.id;
      gm.joinRoom({ userId: alice.profile.id, roomIdOrCode: id, buyinAmount: 1000 });
      gm.startRoomGame(alice.profile.id, id);
      const engine = gm.rooms.get(id)!.blackjackEngine!;
      engine.shoe.push({rank:7,suit:'c'}, {rank:13,suit:'h'}, {rank:10,suit:'d'}, {rank:14,suit:'s'});
      engine.applyAction(alice.profile.id, 'place_bet', 100);
      expect(engine.phase).toBe('settled');
      expect(engine.seats[0].tableChips).toBe(1150);
      expect(settled).toHaveBeenCalledWith(alice.profile.id, id, 1150, 'blackjack_hand');
      await Promise.resolve();
      expect(notify).toHaveBeenCalledWith(alice.profile.id, { type: 'wallet:refresh' });
    } finally { gm.cleanup(); }
  });
});
