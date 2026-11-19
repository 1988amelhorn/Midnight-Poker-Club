import React, { useEffect, useState } from 'react';
import { BarChart3, ChevronLeft, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';

type OwnerMetrics = {
  registeredPlayers: number;
  gamesRecorded: number | null;
  localOnlineUsers: number;
  localActiveTables: number;
  scope: string;
  checkedAt: string;
};

export const OwnerDashboardView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [metrics, setMetrics] = useState<OwnerMetrics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const result = await apiFetch<OwnerMetrics>('/api/owner/metrics');
      setMetrics(result);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load owner statistics');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  const boxes = metrics ? [
    ['Registered accounts', metrics.registeredPlayers.toLocaleString(), 'Verified database total'],
    ['Recorded matches', metrics.gamesRecorded?.toLocaleString() ?? 'Unavailable', 'Saved match records'],
    ['Online here', metrics.localOnlineUsers.toLocaleString(), 'This server instance only'],
    ['Active tables here', metrics.localActiveTables.toLocaleString(), 'This server instance only'],
  ] : [];
  return (
    <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5 text-white">
      <div className="flex gap-3 items-center">
        <button type="button" onClick={onBack} className="btn-glossy btn-glossy-dark w-11 h-11 grid place-items-center rounded-full" aria-label="Back">
          <ChevronLeft size={20}/>
        </button>
        <div>
          <h1 className="font-display font-extrabold text-2xl flex gap-2 items-center"><BarChart3 className="text-cyan-300"/> Club Overview</h1>
          <p className="text-xs text-slate-400">Private owner dashboard · virtual-chip gaming</p>
        </div>
      </div>
      {error && <p role="alert" className="border border-rose-400/40 rounded-xl p-4 text-rose-300 bg-rose-950/25">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        {boxes.map(([label, value, hint]) => (
          <div key={label} className="neon-casino-panel rounded-[26px] p-4 space-y-2">
            <p className="text-xs text-slate-300">{label}</p>
            <p className="font-mono text-2xl sm:text-3xl font-extrabold text-cyan-200">{value}</p>
            <p className="text-[10px] text-slate-400">{hint}</p>
          </div>
        ))}
      </div>
      {metrics && (
        <div className="glass-bubbly rounded-2xl p-4 space-y-2">
          <p className="text-xs text-slate-300 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400"/> Server-verified owner access</p>
          <p className="text-xs text-slate-400">{metrics.scope}</p>
          <p className="text-xs text-slate-500">Checked: {new Date(metrics.checkedAt).toLocaleString()}</p>
        </div>
      )}
      <button type="button" onClick={() => void load()} disabled={loading}
        className="btn-glossy btn-glossy-blue rounded-full px-5 py-3 w-full font-extrabold text-sm flex gap-2 items-center justify-center">
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}/> {loading ? 'Loading…' : 'Refresh counts'}
      </button>
    </main>
  );
};
