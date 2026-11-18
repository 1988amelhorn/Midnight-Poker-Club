import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, getStoredToken, setStoredToken } from '../lib/api.ts';
import { fetchPublicConfig, getSupabaseClient } from '../lib/supabase.ts';
import type {
  AchievementBadge,
  GameRoomSummary,
  PlayerStatistics,
  PlayerWallet,
  UserProfile,
} from '../shared/types.ts';
import { soundEngine } from '../utils/soundEngine.ts';

export interface SupabaseSetupStatus {
  hasUrl: boolean;
  hasPublicKey: boolean;
  hasServiceRole: boolean;
  authEnabled: boolean;
}

interface AuthContextValue {
  loading: boolean;
  supabaseConfigured: boolean;
  supabaseStatus: SupabaseSetupStatus;
  passwordRecoveryActive: boolean;
  token: string | null;
  user: UserProfile | null;
  wallet: PlayerWallet | null;
  stats: PlayerStatistics | null;
  achievements: AchievementBadge[];
  activeRoom: GameRoomSummary | null;
  refreshSession: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  register: (params: { email: string; password: string; username: string; avatarId: string }) => Promise<{ requiresVerification?: boolean }>;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<string>;
  completePasswordReset: (newPassword: string) => Promise<void>;
  cancelPasswordRecovery: () => void;
  resendVerificationEmail: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<UserProfile>) => Promise<void>;
  deleteAccount: () => Promise<void>;
  setWalletBalanceLocally: (newBalance: number) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [supabaseConfigured, setSupabaseConfigured] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseSetupStatus>({
    hasUrl: false,
    hasPublicKey: false,
    hasServiceRole: false,
    authEnabled: false,
  });
  const [passwordRecoveryActive, setPasswordRecoveryActive] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.location.hash.includes('type=recovery');
  });
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [user, setUser] = useState<UserProfile | null>(null);
  const [wallet, setWallet] = useState<PlayerWallet | null>(null);
  const [stats, setStats] = useState<PlayerStatistics | null>(null);
  const [achievements, setAchievements] = useState<AchievementBadge[]>([]);
  const [activeRoom, setActiveRoom] = useState<GameRoomSummary | null>(null);

  const applySoundPrefs = (profile: UserProfile) => {
    soundEngine.configure({
      sfxEnabled: profile.soundEnabled,
      musicEnabled: profile.musicEnabled,
      sfxVolume: profile.sfxVolume,
      musicVolume: profile.musicVolume,
    });
  };

  const loadSessionWithToken = useCallback(async (tok: string) => {
    const data = await apiFetch<{
      user: UserProfile;
      wallet: PlayerWallet;
      stats: PlayerStatistics;
      achievements: AchievementBadge[];
      activeRoom: GameRoomSummary | null;
    }>('/api/auth/session', { token: tok });
    setUser(data.user);
    setWallet(data.wallet);
    setStats(data.stats);
    setAchievements(data.achievements || []);
    setActiveRoom(data.activeRoom || null);
    applySoundPrefs(data.user);
  }, []);

  const refreshSession = useCallback(async () => {
    const tok = getStoredToken();
    if (!tok) {
      setUser(null);
      setWallet(null);
      setStats(null);
      setActiveRoom(null);
      return;
    }
    try {
      await loadSessionWithToken(tok);
    } catch {
      setStoredToken(null);
      setToken(null);
      setUser(null);
      setWallet(null);
    }
  }, [loadSessionWithToken]);

  const refreshWallet = useCallback(async () => {
    const tok = getStoredToken();
    if (!tok) return;
    try {
      const data = await apiFetch<{ wallet: PlayerWallet }>('/api/wallet', { token: tok });
      setWallet(data.wallet);
    } catch {
      // ignore transient
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    (async () => {
      try {
        const cfg = await fetchPublicConfig();
        const clientHasUrl = Boolean(import.meta.env.VITE_SUPABASE_URL || cfg.hasSupabaseUrl);
        const clientHasKey = Boolean(
          import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
          import.meta.env.VITE_SUPABASE_ANON_KEY ||
          cfg.hasSupabasePublicKey
        );
        const authEnabled = Boolean(cfg.supabaseConfigured || cfg.supabaseAuthEnabled || (clientHasUrl && clientHasKey));

        if (mounted) {
          setSupabaseConfigured(authEnabled);
          setSupabaseStatus({
            hasUrl: clientHasUrl,
            hasPublicKey: clientHasKey,
            hasServiceRole: Boolean(cfg.hasServiceRoleKey),
            authEnabled,
          });
        }

        const supabase = await getSupabaseClient();
        if (supabase) {
          const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (!mounted) return;
            if (event === 'PASSWORD_RECOVERY') {
              setPasswordRecoveryActive(true);
            }
            if (session?.access_token) {
              setStoredToken(session.access_token);
              setToken(session.access_token);
              try {
                await loadSessionWithToken(session.access_token);
              } catch {
                // ignore transient
              }
            } else if (event === 'SIGNED_OUT') {
              setStoredToken(null);
              setToken(null);
              setUser(null);
              setWallet(null);
              setStats(null);
              setAchievements([]);
              setActiveRoom(null);
            }
          });
          subscription = listener.subscription;

          const { data } = await supabase.auth.getSession();
          if (data.session?.access_token) {
            setStoredToken(data.session.access_token);
            if (mounted) setToken(data.session.access_token);
            await loadSessionWithToken(data.session.access_token);
          } else {
            const existingTok = getStoredToken();
            if (existingTok) {
              try {
                await loadSessionWithToken(existingTok);
              } catch {
                setStoredToken(null);
                if (mounted) setToken(null);
              }
            }
          }
        } else {
          const existingTok = getStoredToken();
          if (existingTok) {
            try {
              await loadSessionWithToken(existingTok);
            } catch {
              setStoredToken(null);
              if (mounted) setToken(null);
            }
          }
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [loadSessionWithToken]);

  const register = async (params: { email: string; password: string; username: string; avatarId: string }) => {
    const supabase = await getSupabaseClient();
    if (supabase) {
      const check = await apiFetch<{ available: boolean; valid: boolean }>(
        `/api/auth/check-username?username=${encodeURIComponent(params.username)}`,
        { token: null }
      );
      if (!check.valid) throw new Error('Username must be 3–24 letters, numbers, or underscores.');
      if (!check.available) throw new Error('That username is already taken.');

      const { data, error } = await supabase.auth.signUp({
        email: params.email.trim().toLowerCase(),
        password: params.password,
        options: {
          data: { username: params.username.trim(), avatarId: params.avatarId },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw new Error(error.message);

      // Supabase returns identities=[] when an email is already registered under enumeration protection
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('An account with this email already exists. Sign in or reset your password.');
      }

      if (data.session?.access_token) {
        setStoredToken(data.session.access_token);
        setToken(data.session.access_token);
        await loadSessionWithToken(data.session.access_token);
        return { requiresVerification: false };
      }
      return { requiresVerification: true };
    }

    const res = await apiFetch<{
      token?: string;
      user: UserProfile;
      wallet: PlayerWallet;
      stats: PlayerStatistics;
      achievements: AchievementBadge[];
      requiresEmailVerification?: boolean;
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(params),
      token: null,
    });
    if (res.token) {
      setStoredToken(res.token);
      setToken(res.token);
      setUser(res.user);
      setWallet(res.wallet);
      setStats(res.stats);
      setAchievements(res.achievements || []);
      applySoundPrefs(res.user);
    }
    return { requiresVerification: res.requiresEmailVerification };
  };

  const login = async (email: string, password: string) => {
    const supabase = await getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) {
        if (error.message.toLowerCase().includes('email not confirmed')) {
          throw new Error('Please confirm your email address before signing in. Check your inbox or click Resend Verification.');
        }
        throw new Error(error.message);
      }
      if (!data.session?.access_token) {
        throw new Error('Please verify your email address before signing in.');
      }
      setStoredToken(data.session.access_token);
      setToken(data.session.access_token);
      await loadSessionWithToken(data.session.access_token);
      return;
    }

    const res = await apiFetch<{
      token: string;
      user: UserProfile;
      wallet: PlayerWallet;
      stats: PlayerStatistics;
      achievements: AchievementBadge[];
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      token: null,
    });
    setStoredToken(res.token);
    setToken(res.token);
    setUser(res.user);
    setWallet(res.wallet);
    setStats(res.stats);
    setAchievements(res.achievements || []);
    applySoundPrefs(res.user);
  };

  const loginWithGoogle = async () => {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error(
        'Google Sign-In requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (plus Google provider enabled in Supabase Dashboard). Open "Supabase Setup" below for instructions, or use Email & Password in preview mode.'
      );
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw new Error(error.message);
  };

  const requestPasswordReset = async (email: string) => {
    const cleanEmail = email.trim().toLowerCase();
    const supabase = await getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/#reset-password`,
      });
      if (error) throw new Error(error.message);
      return 'Password reset link sent! Check your inbox and open the link to choose a new password.';
    }
    const res = await apiFetch<{ message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: cleanEmail }),
      token: null,
    });
    return res.message;
  };

  const completePasswordReset = async (newPassword: string) => {
    if (newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase Auth session required to update password.');
    }
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);

    setPasswordRecoveryActive(false);
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    const sessionRes = await supabase.auth.getSession();
    const activeToken = sessionRes.data.session?.access_token || getStoredToken();
    if (activeToken && data.user) {
      setStoredToken(activeToken);
      setToken(activeToken);
      await loadSessionWithToken(activeToken);
    }
  };

  const cancelPasswordRecovery = () => {
    setPasswordRecoveryActive(false);
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };

  const resendVerificationEmail = async (email: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) throw new Error('Enter your email address first.');
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Email verification requires Supabase Auth configuration.');
    }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: cleanEmail,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw new Error(error.message);
  };

  const logout = async () => {
    const supabase = await getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setPasswordRecoveryActive(false);
    setStoredToken(null);
    setToken(null);
    setUser(null);
    setWallet(null);
    setStats(null);
    setAchievements([]);
    setActiveRoom(null);
  };

  const updateProfile = async (patch: Partial<UserProfile>) => {
    const res = await apiFetch<{ user: UserProfile }>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setUser(res.user);
    applySoundPrefs(res.user);
  };

  const deleteAccount = async () => {
    await apiFetch('/api/account', { method: 'DELETE' });
    await logout();
  };

  const setWalletBalanceLocally = (newBalance: number) => {
    setWallet((prev) => (prev ? { ...prev, chipBalance: newBalance } : prev));
  };

  return (
    <AuthContext.Provider
      value={{
        loading,
        supabaseConfigured,
        supabaseStatus,
        passwordRecoveryActive,
        token,
        user,
        wallet,
        stats,
        achievements,
        activeRoom,
        refreshSession,
        refreshWallet,
        register,
        login,
        loginWithGoogle,
        requestPasswordReset,
        completePasswordReset,
        cancelPasswordRecovery,
        resendVerificationEmail,
        logout,
        updateProfile,
        deleteAccount,
        setWalletBalanceLocally,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
