import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TableBankroll } from '../src/components/TableBankroll.tsx';

const auth = vi.hoisted(() => ({ wallet: null as null | { chipBalance: number }, refreshWallet: vi.fn() }));
vi.mock('../src/context/AuthContext.tsx', () => ({ useAuth: () => auth }));

describe('table total bankroll', () => {
  it('shows the confirmed combined balance once and reflects subsequent payouts and losses', () => {
    for (const balance of [2575, 2650, 2550, 0, 1000000]) {
      auth.wallet = { chipBalance: balance };
      const html = renderToStaticMarkup(<TableBankroll />);
      expect(html).toContain('Total chips');
      expect(html).toContain(`>${balance.toLocaleString('en-US')}</span>`);
      expect(html).toContain('role="status"');
    }
  });
  it('does not invent a zero balance while the wallet is loading', () => {
    auth.wallet = null;
    const html = renderToStaticMarkup(<TableBankroll />);
    expect(html).toContain('…');
    expect(html).not.toContain('>0</span>');
  });
});
