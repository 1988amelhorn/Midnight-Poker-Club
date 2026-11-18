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

let cachedClient: SupabaseClient | null = null;
let publicConfigPromise: Promise<PublicSupabaseRuntimeConfig> | null = null;

export async function fetchPublicConfig(): Promise<PublicSupabaseRuntimeConfig> {
  if (!publicConfigPromise) {
    publicConfigPromise = fetch('/api/public-config')
      .then((r) => r.json())
      .catch(() => ({
        supabaseConfigured: false,
        supabaseAuthEnabled: false,
        hasSupabaseUrl: false,
        hasSupabasePublicKey: false,
        hasServiceRoleKey: false,
        supabaseUrl: '',
        supabaseAnonKey: '',
      }));
  }
  return publicConfigPromise;
}

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (cachedClient) return cachedClient;

  let url = import.meta.env.VITE_SUPABASE_URL || '';
  let key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    '';

  if (!url || !key || url.includes('your-project-id') || key.includes('your-supabase')) {
    const cfg = await fetchPublicConfig();
    if ((cfg.supabaseAuthEnabled || cfg.supabaseConfigured) && cfg.supabaseUrl && cfg.supabaseAnonKey) {
      url = cfg.supabaseUrl;
      key = cfg.supabaseAnonKey;
    }
  }

  if (!url || !key || url.includes('your-project-id') || key.includes('your-supabase')) {
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
