import React, { useEffect } from 'react';
import { useAuth } from '../context/AuthContext.tsx';

/** The saved wallet already includes cash-game table stacks. Never add them again. */
export function TableBankroll() {
  const { wallet, refreshWallet } = useAuth();

  useEffect(() => {
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try { await refreshWallet(); } catch { /* Retain the last confirmed total. */ }
      finally { pending = false; }
    };
    void refresh();
    // Socket wallet notifications update payouts immediately; polling also recovers
    // missed notifications and gifts while a table stays open on a phone.
    const timer = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refreshWallet]);

  return (
    <div className="basis-full flex justify-end" role="status" aria-live="polite" aria-atomic="true">
      <div className="rounded-full border border-amber-300/50 bg-slate-950/95 px-3 py-1 text-amber-200 shadow-lg flex items-center gap-2 max-w-full">
        <span className="text-[11px] font-bold uppercase tracking-wide shrink-0">Total chips</span>
        <span className="font-mono font-bold text-sm sm:text-base tabular-nums break-all">
          {wallet ? wallet.chipBalance.toLocaleString('en-US') : '…'}
        </span>
      </div>
    </div>
  );
}
