import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Gift, RotateCw, Sparkles } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';

const PRIZES = [250, 1000, 2000, 5000, 25000, 1000000] as const;
const COLORS = ['#1466db', '#7b35d8', '#009a79', '#b8750c', '#b32e8f', '#ffda63'];

export const DailyWheelView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { refreshWallet } = useAuth();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [lastPrize, setLastPrize] = useState<number | null>(null);
  const [nextSpin, setNextSpin] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState('');
  const [displayPrize, setDisplayPrize] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinLock = useRef(false);

  useEffect(() => {
    let active = true;
    void apiFetch<{ canSpin: boolean; lastPrize: number | null; nextSpinAt: string | null }>('/api/wheel/status')
      .then((result) => {
        if (!active) return;
        setAvailable(result.canSpin);
        setLastPrize(result.lastPrize);
        setNextSpin(result.nextSpinAt);
      }).catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load daily spin');
      });
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const spin = async () => {
    if (spinLock.current || !available) return;
    spinLock.current = true;
    setSpinning(true);
    setError('');
    setDisplayPrize(null);
    try {
      const result = await apiFetch<{ prize: number; nextSpinAt: string; balance: number }>(
        '/api/wheel/spin', { method: 'POST' }
      );
      // The prize comes from a server-side SQL transaction; this animation
      // only reveals its result and cannot change the amount.
      const index = PRIZES.indexOf(result.prize as (typeof PRIZES)[number]);
      if (index < 0) throw new Error('Unexpected prize. Check your wallet.');
      setRotation((old) => old + 1800 + ((360 - (index * 60 + 30) - old % 360 + 360) % 360));
      setAvailable(false);
      setNextSpin(result.nextSpinAt);
      setLastPrize(result.prize);
      void refreshWallet();
      timer.current = setTimeout(() => {
        setSpinning(false);
        setDisplayPrize(result.prize);
      }, 4650);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Spin failed. No prize was awarded.');
      setSpinning(false);
    } finally {
      spinLock.current = false;
    }
  };

  return (
    <main className="casino-screen min-h-[75dvh] text-white p-4 sm:p-6">
      <div className="max-w-xl mx-auto space-y-5">
        <div className="flex gap-3 items-center">
          <button onClick={onBack} type="button" className="btn-glossy btn-glossy-dark rounded-full w-11 h-11 grid place-items-center" aria-label="Back to lobby"><ChevronLeft size={20}/></button>
          <div><h1 className="font-display text-2xl font-extrabold text-amber-300">Midnight Daily Spin</h1>
            <p className="text-xs text-slate-300">Free virtual chips · one spin each UTC day</p></div>
        </div>
        <section className="neon-casino-panel p-5 sm:p-8 rounded-[32px] text-center space-y-5">
          <div className="relative mx-auto w-[min(76vw,330px)] aspect-square">
            <div className="absolute left-1/2 -top-4 z-20 -translate-x-1/2 w-0 h-0 border-l-[15px] border-l-transparent border-r-[15px] border-r-transparent border-t-[30px] border-t-amber-200 drop-shadow-[0_0_9px_rgba(255,210,75,0.9)]" aria-hidden="true"/>
            <div className="absolute inset-0 rounded-full border-[10px] border-amber-400 shadow-[0_0_28px_rgba(251,191,36,.65)] overflow-hidden"
              style={{
                background: 'conic-gradient(' + COLORS.map((color,i) => `${color} ${i*60}deg ${(i+1)*60}deg`).join(',') + ')',
                transform: `rotate(${rotation}deg)`,
                transition: spinning ? 'transform 4.6s cubic-bezier(.13,.63,.05,1)' : 'none',
              }}>
              {PRIZES.map((prize,i) => (
                <div key={prize} className="absolute left-1/2 top-1/2 text-white text-[10px] sm:text-xs font-extrabold whitespace-nowrap"
                  style={{ transform: `translate(-50%,-50%) rotate(${i*60+30}deg) translateY(-104px) rotate(-${i*60+30}deg)`, textShadow:'0 2px 5px #000' }}>
                  {prize===1000000?'1M':prize.toLocaleString()}
                </div>
              ))}
            </div>
            <div className="absolute inset-[40%] bg-[#10072c] border-4 border-amber-300 rounded-full grid place-items-center shadow-[0_0_15px_#ffda63]" aria-hidden="true">
              <Gift className="text-amber-300 w-7 h-7"/>
            </div>
          </div>
          <button type="button" onClick={() => void spin()} disabled={!available || spinning}
            className="btn-glossy btn-glossy-gold w-full px-6 py-4 text-slate-950 text-lg font-extrabold rounded-full disabled:opacity-65">
            <span className="flex items-center justify-center gap-2"><RotateCw className={spinning ? 'animate-spin' : ''}/> {spinning ? 'SPINNING…' : available ? 'SPIN THE WHEEL' : 'COME BACK TOMORROW'}</span>
          </button>
          {error && <div role="alert" className="rounded-xl border border-rose-400/40 text-rose-200 text-sm p-3">{error}</div>}
          {displayPrize !== null && <p aria-live="polite" className="text-2xl font-extrabold text-amber-300 flex gap-2 justify-center items-center"><Sparkles/> You won {displayPrize.toLocaleString()} chips!</p>}
          {!available && !spinning && displayPrize === null && lastPrize != null && (
            <p className="text-sm text-emerald-300 font-semibold">Today's prize: {lastPrize.toLocaleString()} chips</p>
          )}
          {nextSpin && <p className="text-xs text-slate-300">Next spin: {new Date(nextSpin).toLocaleString()}</p>}
          <p className="text-xs text-slate-400">Odds per spin: 250 chips 59%, 1,000 chips 30%, 2,000 chips 9.5%, 5,000 chips 1.4%, 25,000 chips 0.099%, and 1,000,000 chips 0.001%.</p>
          <p className="text-[11px] text-slate-500">Prize segments are illustrative, not proportional to their chances. Virtual chips have no cash value or redemption option.</p>
        </section>
      </div>
    </main>
  );
};
