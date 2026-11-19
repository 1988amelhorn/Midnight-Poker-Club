import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronLeft, Info, KeyRound, Lock, Mail, Sparkles, User, XCircle } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { AVATAR_OPTIONS, PlayerAvatar } from '../utils/avatars.tsx';

export type AuthScreenMode = 'welcome' | 'signup' | 'login' | 'reset' | 'new_password';

export const AuthViews: React.FC<{
  initialMode?: AuthScreenMode;
  onSuccess?: () => void;
}> = ({ initialMode = 'welcome', onSuccess }) => {
  const {
    supabaseConfigured,
    supabaseStatus,
    passwordRecoveryActive,
    register,
    login,
    loginWithGoogle,
    requestPasswordReset,
    completePasswordReset,
    cancelPasswordRecovery,
    resendVerificationEmail,
  } = useAuth();
  const [mode, setMode] = useState<AuthScreenMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [avatarId, setAvatarId] = useState(AVATAR_OPTIONS[0].id);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);

  useEffect(() => {
    if (passwordRecoveryActive) {
      setMode('new_password');
    }
  }, [passwordRecoveryActive]);

  useEffect(() => {
    if (mode !== 'signup' || !username.trim()) {
      setUsernameStatus('idle');
      return;
    }
    const clean = username.trim();
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(clean)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch<{ available: boolean; valid: boolean }>(
          `/api/auth/check-username?username=${encodeURIComponent(clean)}`,
          { token: null }
        );
        if (!res.valid) setUsernameStatus('invalid');
        else setUsernameStatus(res.available ? 'available' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 300);
    return () => clearTimeout(t);
  }, [username, mode]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      const res = await register({ email, password, username, avatarId });
      if (res.requiresVerification) {
        setInfoMsg('Account created! Please check your email to verify your address before logging in.');
        setMode('login');
      } else {
        onSuccess?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      await login(email, password);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in unavailable');
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      const msg = await requestPasswordReset(email);
      setInfoMsg(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompletePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await completePasswordReset(password);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update password');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    setError(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      await resendVerificationEmail(email);
      setInfoMsg('Verification email resent. Please check your inbox and spam folder.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend verification email');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-[#050814] p-4 relative overflow-hidden">
      {/* Midnight Skyline & Ambient Neon Radial Glow */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30 bg-cover bg-center"
        style={{ backgroundImage: 'url(/src/assets/images/neon_hero_skyline_1795020140555.jpg)' }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#050814]/85 via-[#070b1d]/75 to-[#040610]/95" />
      <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[540px] h-[540px] rounded-full bg-cyan-500/18 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-24 right-1/4 w-[440px] h-[440px] rounded-full bg-purple-600/22 blur-[120px]" />

      <div className="relative z-10 w-full max-w-md rounded-[32px] glass-bubbly border-2 border-cyan-400/35 p-6 sm:p-8 shadow-[0_0_50px_rgba(56,189,248,0.22),0_20px_50px_rgba(0,0,0,0.8)]">
        {mode !== 'welcome' && (
          <div className="flex items-center justify-between gap-2 mb-5">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setInfoMsg(null);
                setMode('welcome');
              }}
              className="inline-flex items-center gap-1.5 rounded-full btn-glossy btn-glossy-dark px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:text-white"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <div className="text-right">
              <p className="text-xs font-display font-extrabold tracking-wider bg-gradient-to-r from-cyan-300 via-sky-400 to-purple-400 bg-clip-text text-transparent">
                MIDNIGHT <span className="text-amber-300">POKER CLUB</span>
              </p>
              <p className="text-[10px] text-slate-400">Where Legends Go All In.</p>
            </div>
          </div>
        )}

        {/* Welcome Screen */}
        {mode === 'welcome' && (
          <div className="text-center space-y-6">
            <div className="space-y-1">
              <h1 className="text-4xl font-display font-extrabold tracking-tight bg-gradient-to-r from-cyan-300 via-sky-400 to-purple-400 bg-clip-text text-transparent drop-shadow-[0_0_22px_rgba(34,211,238,0.6)]">
                MIDNIGHT
              </h1>
              <p className="text-sm font-display font-bold tracking-[0.26em] text-amber-300 uppercase drop-shadow-[0_0_12px_rgba(250,204,21,0.45)]">
                POKER CLUB
              </p>
            </div>

            <div className="relative mx-auto w-56 h-56 rounded-[28px] overflow-hidden border-2 border-cyan-400/50 shadow-[0_0_45px_rgba(34,211,238,0.28)] bg-slate-950">
              <img
                src="/midnight-login-logo.webp"
                alt="Midnight Poker Club moon, crowned poker chip and neon skyline logo"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>

            <div>
              <p className="text-base font-display font-bold text-amber-200">Where Legends Go All In.</p>
              <p className="text-xs text-slate-300/85 mt-1">
                Social Texas Hold&apos;em, Blackjack &amp; Tournaments · 5,000 virtual welcome chips · No real-money gambling
              </p>
            </div>

            {error && <div className="rounded-2xl bg-rose-500/15 border border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-300">{error}</div>}

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setMode('signup')}
                className="w-full py-3.5 rounded-full btn-glossy btn-glossy-green text-slate-950 font-display font-extrabold text-sm"
              >
                Sign Up
              </button>
              <button
                type="button"
                onClick={() => setMode('login')}
                className="w-full py-3.5 rounded-full btn-glossy btn-glossy-blue text-white font-display font-bold text-sm"
              >
                Login
              </button>

              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-slate-700/70" />
                <span className="text-[11px] text-slate-400 uppercase font-semibold">or</span>
                <span className="h-px flex-1 bg-slate-700/70" />
              </div>

              <button
                type="button"
                onClick={() => void handleGoogle()}
                className="w-full py-3.5 rounded-full btn-glossy btn-glossy-dark text-slate-100 font-semibold text-sm flex items-center justify-center gap-2.5"
              >
                <span className="w-5 h-5 rounded-full bg-white text-slate-950 font-extrabold text-xs inline-flex items-center justify-center shadow">G</span>
                <span>Continue with Google</span>
              </button>
            </div>

            <div className="pt-1 flex flex-col items-center gap-1.5 text-[11px] text-slate-400">
              <span>
                {supabaseConfigured
                  ? supabaseStatus.hasServiceRole
                    ? 'Connected to Supabase Auth & PostgreSQL'
                    : 'Connected to Supabase Auth (Client Project Linked)'
                  : 'Preview Mode: Add Supabase credentials to enable Cloud Auth & Google OAuth'}
              </span>
              <button
                type="button"
                onClick={() => setShowSetupModal(true)}
                className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200 font-semibold"
              >
                <Info className="w-3.5 h-3.5" />
                <span>{supabaseConfigured ? 'View Supabase & OAuth Status' : 'Supabase & OAuth Setup Instructions'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Sign Up Screen */}
        {mode === 'signup' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <h2 className="text-2xl font-display font-bold text-white">Create Account</h2>
              <p className="text-xs text-slate-400 mt-0.5">Receive 5,000 virtual welcome chips upon joining</p>
            </div>

            {error && <div className="rounded-2xl bg-rose-500/15 border border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-300">{error}</div>}

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Choose Avatar</label>
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {AVATAR_OPTIONS.map((av) => (
                  <button
                    key={av.id}
                    type="button"
                    onClick={() => setAvatarId(av.id)}
                    className={`p-1 rounded-full transition ${
                      avatarId === av.id ? 'ring-2 ring-cyan-400 bg-cyan-500/20 shadow-[0_0_16px_rgba(34,211,238,0.45)]' : 'opacity-65 hover:opacity-100'
                    }`}
                  >
                    <PlayerAvatar avatarId={av.id} size="sm" />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Username</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="MidnightShark"
                  required
                  className="w-full rounded-2xl input-bubbly pl-10 pr-10 py-2.5 text-sm text-white"
                />
                {usernameStatus === 'available' && <CheckCircle2 className="w-4 h-4 text-emerald-400 absolute right-3 top-1/2 -translate-y-1/2" />}
                {(usernameStatus === 'taken' || usernameStatus === 'invalid') && (
                  <XCircle className="w-4 h-4 text-rose-400 absolute right-3 top-1/2 -translate-y-1/2" />
                )}
              </div>
              {usernameStatus === 'taken' && <p className="text-[11px] text-rose-400 mt-1">Username already taken</p>}
              {usernameStatus === 'invalid' && <p className="text-[11px] text-amber-400 mt-1">Use 3–24 letters, numbers, or underscores</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="player@example.com"
                  required
                  className="w-full rounded-2xl input-bubbly pl-10 pr-4 py-2.5 text-sm text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  minLength={6}
                  required
                  className="w-full rounded-2xl input-bubbly pl-10 pr-4 py-2.5 text-sm text-white"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || usernameStatus === 'taken' || usernameStatus === 'invalid'}
              className="w-full py-3.5 rounded-full btn-glossy btn-glossy-green text-slate-950 font-display font-extrabold text-sm disabled:opacity-50"
            >
              {submitting ? 'Creating Account...' : 'Create Account & Claim 5,000 Chips'}
            </button>

            <p className="text-center text-xs text-slate-400">
              Already have an account?{' '}
              <button type="button" onClick={() => setMode('login')} className="text-cyan-300 font-semibold hover:underline">
                Login
              </button>
            </p>
          </form>
        )}

        {/* Login Screen */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <img
              src="/midnight-login-logo.webp"
              alt="Midnight Poker Club neon logo"
              className="w-40 h-40 object-contain rounded-2xl mx-auto border border-cyan-400/35 shadow-[0_0_24px_rgba(34,211,238,0.20)]"
            />
            <div>
              <h2 className="text-2xl font-display font-bold text-white">Welcome Back</h2>
              <p className="text-xs text-slate-400 mt-0.5">Sign in to resume your virtual tables and tournaments</p>
            </div>

            {error && (
              <div className="rounded-2xl bg-rose-500/15 border border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-300 space-y-1.5">
                <p>{error}</p>
                {error.toLowerCase().includes('confirm') && supabaseConfigured && (
                  <button
                    type="button"
                    onClick={() => void handleResendVerification()}
                    disabled={submitting}
                    className="text-cyan-300 font-semibold underline hover:text-cyan-200"
                  >
                    Resend verification email
                  </button>
                )}
              </div>
            )}
            {infoMsg && <div className="rounded-2xl bg-emerald-500/15 border border-emerald-500/40 px-3.5 py-2.5 text-xs text-emerald-300">{infoMsg}</div>}

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-2xl input-bubbly px-4 py-2.5 text-sm text-white"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-300">Password</label>
                <button type="button" onClick={() => setMode('reset')} className="text-xs text-cyan-300 hover:underline">
                  Forgot password?
                </button>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-2xl input-bubbly px-4 py-2.5 text-sm text-white"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 rounded-full btn-glossy btn-glossy-blue text-white font-display font-extrabold text-sm disabled:opacity-50"
            >
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>

            <button
              type="button"
              onClick={() => void handleGoogle()}
              className="w-full py-3 rounded-full btn-glossy btn-glossy-dark text-slate-100 font-semibold text-sm flex items-center justify-center gap-2"
            >
              <span className="w-5 h-5 rounded-full bg-white text-slate-950 font-extrabold text-xs inline-flex items-center justify-center">G</span>
              <span>Continue with Google</span>
            </button>

            <p className="text-center text-xs text-slate-400">
              New to Midnight Poker Club?{' '}
              <button type="button" onClick={() => setMode('signup')} className="text-emerald-400 font-semibold hover:underline">
                Sign Up
              </button>
            </p>
          </form>
        )}

        {/* Password Reset Screen */}
        {mode === 'reset' && (
          <form onSubmit={handleReset} className="space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-400" />
              <h2 className="text-xl font-display font-bold text-white">Reset Password</h2>
            </div>
            <p className="text-xs text-slate-400">Enter your registered email address to receive recovery instructions.</p>

            {error && <div className="rounded-2xl bg-rose-500/15 border border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-300">{error}</div>}
            {infoMsg && <div className="rounded-2xl bg-emerald-500/15 border border-emerald-500/40 px-3.5 py-2.5 text-xs text-emerald-300">{infoMsg}</div>}

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-2xl input-bubbly px-4 py-2.5 text-sm text-white"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 rounded-full btn-glossy btn-glossy-blue text-white font-display font-extrabold text-sm"
            >
              {submitting ? 'Sending...' : 'Send Reset Link'}
            </button>

            <button type="button" onClick={() => setMode('login')} className="w-full text-center text-xs text-slate-400 hover:text-white">
              Return to Login
            </button>
          </form>
        )}

        {/* Set New Password Screen (after clicking Supabase recovery email link) */}
        {mode === 'new_password' && (
          <form onSubmit={handleCompletePasswordReset} className="space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-emerald-400" />
              <h2 className="text-xl font-display font-bold text-white">Choose New Password</h2>
            </div>
            <p className="text-xs text-slate-400">
              Enter your new password below to restore access to your Midnight Poker Club account.
            </p>

            {error && <div className="rounded-2xl bg-rose-500/15 border border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-300">{error}</div>}

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">New Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
                placeholder="Minimum 6 characters"
                className="w-full rounded-2xl input-bubbly px-4 py-2.5 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={6}
                required
                placeholder="Re-enter password"
                className="w-full rounded-2xl input-bubbly px-4 py-2.5 text-sm text-white"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 rounded-full btn-glossy btn-glossy-green text-slate-950 font-display font-extrabold text-sm"
            >
              {submitting ? 'Updating Password...' : 'Save Password & Enter Club'}
            </button>

            <button
              type="button"
              onClick={() => {
                cancelPasswordRecovery();
                setMode('login');
              }}
              className="w-full text-center text-xs text-slate-400 hover:text-white"
            >
              Cancel & Return to Login
            </button>
          </form>
        )}
      </div>

      {/* Supabase Credentials & OAuth Setup Guidance Modal */}
      {showSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-[28px] glass-bubbly border-2 border-cyan-400/35 p-6 space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-display font-bold text-white">Supabase &amp; OAuth Configuration</h3>
              <button
                type="button"
                onClick={() => setShowSetupModal(false)}
                className="px-3 py-1 rounded-full btn-glossy btn-glossy-dark text-xs font-semibold text-slate-200 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="space-y-2 rounded-2xl bg-slate-900/90 border border-slate-700/80 p-3.5 text-xs">
              <p className="font-semibold text-slate-200 mb-1">Environment Variable Status</p>
              <div className="flex items-center justify-between">
                <span className="font-mono text-slate-300">VITE_SUPABASE_URL</span>
                <span className={supabaseStatus.hasUrl ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {supabaseStatus.hasUrl ? 'Configured' : 'Missing'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-slate-300">VITE_SUPABASE_PUBLISHABLE_KEY</span>
                <span className={supabaseStatus.hasPublicKey ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {supabaseStatus.hasPublicKey ? 'Configured' : 'Missing'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-slate-300">SUPABASE_SERVICE_ROLE_KEY (server-only)</span>
                <span className={supabaseStatus.hasServiceRole ? 'text-emerald-400 font-bold' : 'text-slate-400 font-semibold'}>
                  {supabaseStatus.hasServiceRole ? 'Configured' : 'Optional (Recommended for production)'}
                </span>
              </div>
            </div>

            <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
              <p className="font-semibold text-white">Required Supabase Dashboard Steps:</p>
              <ol className="list-decimal pl-4 space-y-1.5">
                <li>
                  Run SQL migrations in order in <strong>Supabase SQL Editor</strong>:{' '}
                  <code className="text-cyan-300">001_initial_schema.sql</code>,{' '}
                  <code className="text-cyan-300">002_realtime_and_atomic_table_rpc.sql</code>, and{' '}
                  <code className="text-cyan-300">003_supabase_auth_self_bootstrap.sql</code>.
                </li>
                <li>
                  In <strong>Authentication → Providers</strong>, enable <strong>Email</strong> and{' '}
                  <strong>Google</strong> OAuth (paste your Google Client ID &amp; Secret).
                </li>
                <li>
                  In <strong>Authentication → URL Configuration</strong>, set Site URL and add this Redirect URL:{' '}
                  <code className="text-emerald-300 break-all">
                    {typeof window !== 'undefined' ? window.location.origin : 'https://your-app-url'}
                  </code>
                </li>
                <li>
                  Set <code className="text-cyan-300">VITE_SUPABASE_URL</code> and{' '}
                  <code className="text-cyan-300">VITE_SUPABASE_PUBLISHABLE_KEY</code> in Secrets (never add{' '}
                  <code className="text-rose-300">SUPABASE_SERVICE_ROLE_KEY</code> to frontend env vars).
                </li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
