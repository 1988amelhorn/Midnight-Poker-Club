import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-2 rounded-xl bg-cyan-500/15 border border-cyan-400/50 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 transition whitespace-nowrap shrink-0 min-h-[40px]"
      >
        <Download className="w-4 h-4" />
        <span>{compact ? 'Install' : 'Install App'}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 transition whitespace-nowrap shrink-0 min-h-[40px]"
        >
          <Download className="w-4 h-4 text-cyan-400" />
          <span>Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#0d1322] p-6 shadow-2xl">
              <h3 className="text-lg font-display font-bold text-white">Install Midnight Poker Club</h3>
              <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                1. Tap the <strong>Share</strong> button in Safari&apos;s toolbar.<br />
                2. Scroll down and tap <strong>Add to Home Screen</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-cyan-600 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 transition"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
