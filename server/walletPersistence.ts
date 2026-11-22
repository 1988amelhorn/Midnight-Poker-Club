import { createHmac, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface WalletEvent {
  uid: string;
  op: 'buyin' | 'cashout' | 'settle' | 'recover' | 'adjust';
  amount: number;
  room?: string;
  reason?: string;
  process: string;
  nonce: string;
}

/** Ordered, durable outbox. The same nonce is reused after a failed response. */
export class WalletWriteQueue {
  private events: WalletEvent[];
  private running = new Set<string>();
  private completions = new Map<string, { resolve: (value: number) => void; promise: Promise<number> }>();

  constructor(private file: string | null, private send: (event: WalletEvent) => Promise<number>) {
    this.events = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
    for (const uid of new Set(this.events.map(e => e.uid))) void this.pump(uid);
  }

  enqueue(event: Omit<WalletEvent, 'nonce'>): Promise<number> {
    const entry = { ...event, nonce: randomUUID() };
    let resolve!: (value: number) => void;
    const promise = new Promise<number>(r => { resolve = r; });
    this.completions.set(entry.nonce, { resolve, promise });
    // Persist before publishing the event to the worker. A disk failure must
    // never turn an unsaved payout into an acknowledged operation.
    const next = [...this.events, entry];
    try { this.save(next); }
    catch (error) { this.completions.delete(entry.nonce); throw error; }
    this.events = next;
    void this.pump(entry.uid);
    return promise;
  }

  private save(events = this.events) {
    if (!this.file) return;
    const file = openSync(this.file + '.tmp', 'w', 0o600);
    try {
      writeFileSync(file, JSON.stringify(events));
      fsyncSync(file);
    } finally { closeSync(file); }
    renameSync(this.file + '.tmp', this.file);
    // Persist the rename as well as its contents on the Linux game host.
    const directory = openSync(dirname(this.file), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }

  private async pump(uid: string) {
    if (this.running.has(uid)) return;
    this.running.add(uid);
    let delay = 500;
    try {
      for (;;) {
        const event = this.events.find(e => e.uid === uid);
        if (!event) return;
        try {
          const balance = await this.send(event);
          const next = this.events.filter(e => e.nonce !== event.nonce);
          this.save(next);
          this.events = next;
          this.completions.get(event.nonce)?.resolve(balance);
          this.completions.delete(event.nonce);
          delay = 500;
        } catch {
          // Never discard a payout or send a later event ahead of it.
          await new Promise<void>(resolve => { const timer = setTimeout(resolve, delay); timer.unref?.(); });
          delay = Math.min(delay * 2, 30_000);
        }
      }
    } finally { this.running.delete(uid); }
  }

  async flush(uid: string, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.events.some(e => e.uid === uid)) {
      if (Date.now() >= deadline) throw new Error('Wallet save is pending. Please retry shortly.');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}

export function signWalletEvent(event: WalletEvent, secret: string, issuedAt = Date.now()) {
  const payload = JSON.stringify({ ...event, issuedAt });
  return { p_payload: payload, p_signature: createHmac('sha256', secret).update(payload).digest('hex') };
}

export async function claimSavedDailyBonus(db: { rpc: (name: string) => any }) {
  const { data, error } = await db.rpc('claim_midnight_daily_bonus');
  if (error) throw new Error('Daily bonus could not be saved. Please try again.');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !Number.isSafeInteger(Number(row.new_balance)) || !Number.isSafeInteger(Number(row.available_balance)) || !row.next_claim_at) {
    throw new Error('Daily bonus was not confirmed. Please refresh your wallet.');
  }
  return { ok: Boolean(row.claimed), claimed: Boolean(row.claimed), newBalance: Number(row.new_balance), availableBalance: Number(row.available_balance), nextClaimAt: row.next_claim_at as string, streak: Number(row.streak),
    ...(row.claimed ? {} : { error: 'Daily 2,000-chip bonus already claimed in the last 24 hours' }) };
}
