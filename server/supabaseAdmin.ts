import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const publicAnonKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

function isValidValue(val: string): boolean {
  return Boolean(
    val &&
      !val.includes('your-project-id') &&
      !val.includes('your-supabase')
  );
}

export const hasSupabaseUrl = isValidValue(supabaseUrl);
export const hasSupabasePublicKey = isValidValue(publicAnonKey);
export const hasSupabaseServiceRole = isValidValue(serviceRoleKey);

// Full Supabase backend persistence requires URL + service role key;
// Auth verification still works if URL + public/anon key are configured.
export const isSupabaseConfigured = hasSupabaseUrl && hasSupabaseServiceRole;
export const isSupabaseAuthEnabled = hasSupabaseUrl && (hasSupabaseServiceRole || hasSupabasePublicKey);

export const publicSupabaseConfig = {
  supabaseUrl: hasSupabaseUrl ? supabaseUrl : '',
  supabaseAnonKey: hasSupabasePublicKey ? publicAnonKey : '',
};

export const supabaseAdmin: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

export const supabaseAuthVerifier: SupabaseClient | null =
  supabaseAdmin ??
  (isSupabaseAuthEnabled
    ? createClient(supabaseUrl, publicAnonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    : null);

export function createSupabaseUserClient(accessToken: string): SupabaseClient | null {
  if (!hasSupabaseUrl || !hasSupabasePublicKey || !accessToken) return null;
  return createClient(supabaseUrl, publicAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

