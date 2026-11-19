('Please verify your email address before signing in.');
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
