import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);

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

  // Some Android browsers never emit beforeinstallprompt, including
  // embedded in-app browsers. Still offer an honest manual installation path.
  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
  if (isAndroid) {
    return (
      <>
        <button type="button" onClick={() => setShowAndroidGuide(true)}
          className="btn-glossy btn-glossy-blue inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold text-white min-h-[40px]">
          <Download className="w-4 h-4" />
          {compact ? 'Install' : 'Install on Android'}
        </button>
        {showAndroidGuide && (
          <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowAndroidGuide(false)}>
            <div role="dialog" aria-modal="true" aria-label="Install on Android"
              className="neon-casino-panel w-full max-w-sm rounded-[28px] p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-display font-bold text-white">Add Midnight Poker Club to your phone</h3>
              <p className="text-sm text-slate-200 leading-relaxed">
                Open this website in Chrome. Tap the <strong>three-dot menu (⋮)</strong>,
                then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                The game will appear as an icon on your phone.
              </p>
              <p className="text-xs text-slate-400">If you are in an in-app browser, use its menu to open the website in Chrome first.</p>
              <button type="button" onClick={() => setShowAndroidGuide(false)}
                className="btn-glossy btn-glossy-blue rounded-full w-full py-3 text-white font-bold">Got it</button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
