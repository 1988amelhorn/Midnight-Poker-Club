import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface PublicSupabaseRuntimeConfig {
  supabaseConfigured: boolean;
  supabaseAuthEnabled?: boolean;
  hasSupabaseUrl?: boolean;
  hasSupabasePublicKey?: boolean;
  hasServiceRoleKey?: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

const EMPTY_CONFIG: PublicSupabaseRuntimeConfig = {
  supabaseConfigured: false,
  supabaseAuthEnabled: false,
  hasSupabaseUrl: false,
  hasSupabasePublicKey: false,
  hasServiceRoleKey: false,
  supabaseUrl: '',
  supabaseAnonKey: '',
};

let cachedClient: SupabaseClient | null = null;
let cachedPublicConfig: PublicSupabaseRuntimeConfig | null = null;
let inflightPublicConfig: Promise<PublicSupabaseRuntimeConfig> | null = null;

function isPlaceholder(value: string): boolean {
  return !value || value.includes('your-project-id') || value.includes('your-supabase');
}

/**
 * Reads the runtime Supabase settings from the game server.
 * Successful responses are cached; a failed request is never cached, so a single
 * hiccup at boot cannot permanently drop the app into offline/local auth mode.
 */
export async function fetchPublicConfig(force = false): Promise<PublicSupabaseRuntimeConfig> {
  if (!force && cachedPublicConfig) return cachedPublicConfig;
  if (inflightPublicConfig) return inflightPublicConfig;

  inflightPublicConfig = (async () => {
    try {
      const res = await fetch('/api/public-config', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`public-config ${res.status}`);
      const cfg = (await res.json()) as Partial<PublicSupabaseRuntimeConfig>;
      cachedPublicConfig = { ...EMPTY_CONFIG, ...cfg };
      return cachedPublicConfig;
    } catch {
      return EMPTY_CONFIG;
    } finally {
      inflightPublicConfig = null;
    }
  })();

  return inflightPublicConfig;
}

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (cachedClient) return cachedClient;

  let url = import.meta.env.VITE_SUPABASE_URL || '';
  let key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    '';

  if (isPlaceholder(url) || isPlaceholder(key)) {
    const cfg = await fetchPublicConfig();
    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
      url = cfg.supabaseUrl;
      key = cfg.supabaseAnonKey;
    }
  }

  if (isPlaceholder(url) || isPlaceholder(key)) {
    return null;
  }

  cachedClient = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cachedClient;
}

/** Current access token from the persisted Supabase session (refreshed when expired). */
export async function getSupabaseAccessToken(): Promise<string | null> {
  const supabase = await getSupabaseClient();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) return null;
    const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
    if (expiresAt && expiresAt - Date.now() < 30_000) {
      const refreshed = await supabase.auth.refreshSession();
      return refreshed.data.session?.access_token ?? session.access_token;
    }
    return session.access_token;
  } catch {
    return null;
  }
}
