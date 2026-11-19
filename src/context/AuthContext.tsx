import React, { createContext, useCallback, useEffect, useState, useContext } from 'react';
import { apiFetch, getStoredToken, setStoredToken } from '../lib/api.ts';
import { getSupabaseClient } from '../lib/supabase.ts';
import type { AchievementBadge, GameRoomSummary, PlayerStatistics, PlayerWallet, UserProfile } from '../shared/types.ts';
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

type LegacyProfile = {
  uid: string;
  username: string;
  avatar_url: string;
  chips: number;
  total_hands_played: number;
  hands_won: number;
  tournament_wins: number;
  blackjack_wins: number;
  lifetime_winnings: number;
  last_reload_at: string | null;
  created_at: string;
  updated_at: string;
};

const asNumber = (v: unknown): number => Number(v || 0);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [supabaseConfigured, setSupabaseConfigured] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseSetupStatus>({
    hasUrl: false, hasPublicKey: false, hasServiceRole: false, authEnabled: false,
  });
  const [passwordRecoveryActive, setPasswordRecoveryActive] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.location.hash.includes('type=recovery')
  );
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [user, setUser] = useState<UserProfile | null>(null);
  const [wallet, setWallet] = useState<PlayerWallet | null>(null);
  const [stats, setStats] = useState<PlayerStatistics | null>(null);
  const [achievements, setAchievements] = useState<AchievementBadge[]>([]);
  const [activeRoom, setActiveRoom] = useState<GameRoomSummary | null>(null);

  const clearLocalSession = useCallback(() => {
    setStoredToken(null);
    setToken(null);
    setUser(null);
    setWallet(null);
    setStats(null);
    setAchievements([]);
    setActiveRoom(null);
  }, []);

  // Supabase Auth is the source of truth. The existing production schema uses
  // public.profiles.uid and public.profiles.chips, not player_wallets/id.
  const loadSessionWithToken = useCallback(async (tok: string) => {
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error('Supabase URL and publishable key are not configured in Vercel.');

    const { data: auth, error: authError } = await supabase.auth.getUser(tok);
    if (authError || !auth.user) throw new Error(authError?.message || 'Authentication session invalid.');

    const { data, error } = await supabase
      .from('profiles')
      .select('uid,username,avatar_url,chips,total_hands_played,hands_won,tournament_wins,blackjack_wins,lifetime_winnings,last_reload_at,created_at,updated_at')
      .eq('uid', auth.user.id)
      .single();

    if (error || !data) {
      throw new Error(`Signed in, but unable to load player profile: ${error?.message || 'Not found'}. Check the profiles SELECT RLS policy.`);
    }
    const p = data as LegacyProfile;
    const profile: UserProfile = {
      id: auth.user.id,
      email: auth.user.email || '',
      username: p.username,
      avatarId: p.avatar_url || 'ace-spade',
      bio: '',
      role: 'player',
      level: 1,
      xp: 0,
      isSuspended: false,
      emailVerified: Boolean(auth.user.email_confirmed_at),
      soundEnabled: true,
      musicEnabled: false,
      sfxVolume: 0.75,
      musicVolume: 0.3,
      reducedAnimations: false,
      preferredSpeed: 'normal',
      createdAt: p.created_at,
      lastSeenAt: p.updated_at || p.created_at,
    };
    const playerWallet: PlayerWallet = {
      userId: auth.user.id,
      chipBalance: asNumber(p.chips),
      welcomeBonusClaimed: true,
      lastDailyBonusAt: p.last_reload_at,
      nextDailyBonusAt: null,
      dailyStreak: 0,
      lifetimeWon: asNumber(p.lifetime_winnings),
      lifetimeLost: 0,
    };
    const playerStats: PlayerStatistics = {
      userId: auth.user.id,
      pokerHandsPlayed: asNumber(p.total_hands_played),
      pokerHandsWon: asNumber(p.hands_won),
      tournamentsPlayed: 0,
      tournamentsWon: asNumber(p.tournament_wins),
      blackjackHandsPlayed: 0,
      blackjackHandsWon: asNumber(p.blackjack_wins),
      blackjackBlackjacks: 0,
      totalGamesPlayed: asNumber(p.total_hands_played),
    };
    setStoredToken(tok);
    setToken(tok);
    setUser(profile);
    setWallet(playerWallet);
    setStats(playerStats);
    setAchievements([]);
    setActiveRoom(null);
    soundEngine.configure({
      sfxEnabled: profile.soundEnabled,
      musicEnabled: profile.musicEnabled,
      sfxVolume: profile.sfxVolume,
      musicVolume: profile.musicVolume,
    });
  }, []);

  const refreshSession = useCallback(async () => {
    const supabase = await getSupabaseClient();
    if (!supabase) { clearLocalSession(); return; }
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) { clearLocalSession(); return; }
    await loadSessionWithToken(data.session.access_token);
  }, [loadSessionWithToken, clearLocalSession]);

  const refreshWallet = useCallback(async () => {
    const supabase = await getSupabaseClient();
    const { data: session } = await (supabase?.auth.getSession() ?? Promise.resolve({ data: { session: null } }));
    if (!supabase || !session.session) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('chips,last_reload_at,lifetime_winnings')
      .eq('uid', session.session.user.id)
      .single();
    if (error) throw new Error(`Unable to refresh chips: ${error.message}`);
    setWallet(prev => prev ? {
      ...prev,
      chipBalance: asNumber(data.chips),
      lastDailyBonusAt: data.last_reload_at,
      lifetimeWon: asNumber(data.lifetime_winnings),
    } : prev);
  }, []);

  useEffect(() => {
    let mounted = true;
    let unsubscribe = () => {};
    (async () => {
      try {
        const supabase = await getSupabaseClient();
        if (!mounted) return;
        const hasUrl = Boolean(import.meta.env.VITE_SUPABASE_URL);
        const hasPublicKey = Boolean(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY);
        setSupabaseConfigured(Boolean(supabase));
        setSupabaseStatus({ hasUrl, hasPublicKey, hasServiceRole: false, authEnabled: Boolean(supabase) });
        if (!supabase) throw new Error('Supabase is not configured in the deployed frontend.');

        const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
          if (!mounted) return;
          if (event === 'PASSWORD_RECOVERY') setPasswordRecoveryActive(true);
          if (event === 'SIGNED_OUT') { clearLocalSession(); return; }
          if (session?.access_token) {
            // Avoid awaiting Supabase queries inside the auth callback.
            Promise.resolve().then(() => loadSessionWithToken(session.access_token))
              .catch(err => console.error('Player profile load failed:', err));
          }
        });
        unsubscribe = () => listener.subscription.unsubscribe();
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data.session?.access_token) await loadSessionWithToken(data.session.access_token);
        else clearLocalSession();
      } catch (err) {
        console.error('Authentication initialization failed:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; unsubscribe(); };
  }, [clearLocalSession, loadSessionWithToken]);

  const register = async (params: { email: string; password: string; username: string; avatarId: string }) => {
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured in Vercel.');
    const username = params.username.trim();
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      throw new Error('Username must be 3–24 letters, numbers, or underscores.');
    }
    const { data: matches, error: checkError } = await supabase
      .from('profiles').select('uid').ilike('username', username).limit(1);
    if (checkError) throw new Error(`Username check failed: ${checkError.message}`);
    if (matches?.length) throw new Error('That username is already taken.');

    const { data, error } = await supabase.auth.signUp({
      email: params.email.trim().toLowerCase(),
      password: params.password,
      options: {
        data: { username, avatar_url: params.avatarId },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) throw new Error(error.message);
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('An account with this email may already exist. Sign in or reset your password.');
    }
    if (data.session?.access_token) {
      await loadSessionWithToken(data.session.access_token);
      return { requiresVerification: false };
    }
    return { requiresVerification: true };
  };

  const login = async (email: string, password: string) => {
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured in Vercel.');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password,
    });
    if (error) throw new Error(error.message);
    if (!data.session?.access_token) throw new Error('Please verify your email address before signing in.');
    await loadSessionWithToken(data.session.access_token);
  };

  const loginWithGoogle = async () => {
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured in Vercel.');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google', options: { redirectTo: window.location.origin },
    });
    if (error) throw new Error(error.message);
  };

  const requestPasswordReset = async (email: string) => {
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured in Vercel.');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/#reset-password`,
    });
    if (error) throw new Error(error.message);
    return 'Password reset link sent! Check your inbox.';
  };

  const completePasswordReset = async (newPassword: string) => {
    if (newPassword.length < 6) throw new Error('New password must be at least 6 characters.');
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured in Vercel.');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
    setPasswordRecoveryActive(false);
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    await refreshSession();
  };

  const cancelPasswordRecovery = () => {
    setPasswordRecoveryActive(false);
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };

  const resendVerificationEmail = async (email: string) => {
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured in Vercel.');
    const { error } = await supabase.auth.resend({
      type: 'signup', email: email.trim().toLowerCase(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw new Error(error.message);
  };

  const logout = async () => {
    const supabase = await getSupabaseClient();
    if (supabase) await supabase.auth.signOut();
    setPasswordRecoveryActive(false);
    clearLocalSession();
  };

  // These features still need the Express backend. Do not expose a service key
  // in the browser or write profile/chip balances directly from the client.
  const updateProfile = async (patch: Partial<UserProfile>) => {
    const res = await apiFetch<{ user: UserProfile }>('/api/profile', {
      method: 'PATCH', body: JSON.stringify(patch),
    });
    setUser(res.user);
  };
  const deleteAccount = async () => {
    await apiFetch('/api/account', { method: 'DELETE' });
    await logout();
  };
  const setWalletBalanceLocally = (newBalance: number) => {
    setWallet(prev => prev ? { ...prev, chipBalance: newBalance } : prev);
  };

  return <AuthContext.Provider value={{
    loading, supabaseConfigured, supabaseStatus, passwordRecoveryActive,
    token, user, wallet, stats, achievements, activeRoom,
    refreshSession, refreshWallet, register, login, loginWithGoogle,
    requestPasswordReset, completePasswordReset, cancelPasswordRecovery,
    resendVerificationEmail, logout, updateProfile, deleteAccount,
    setWalletBalanceLocally,
  }}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
