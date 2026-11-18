import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hasSupabasePublicKey,
  hasSupabaseServiceRole,
  hasSupabaseUrl,
  isSupabaseAuthEnabled,
  isSupabaseConfigured,
  supabaseAdmin,
} from '../server/supabaseAdmin.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../supabase/migrations');

const REQUIRED_TABLES = [
  'profiles',
  'player_wallets',
  'chip_transactions',
  'daily_bonus_claims',
  'game_rooms',
  'room_members',
  'poker_hands',
  'poker_hand_results',
  'blackjack_rounds',
  'tournaments',
  'tournament_players',
  'friendships',
  'friend_requests',
  'chat_messages',
  'notifications',
  'game_history',
  'player_statistics',
  'achievements',
  'moderation_reports',
  'app_settings',
];

function getMigrationFiles(): string[] {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(migrationsDir, f));
}

function hasPsqlBinary(): boolean {
  try {
    execFileSync('psql', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function verifyTablesViaSupabaseApi(): Promise<{ ok: boolean; missing: string[]; checked: number }> {
  if (!supabaseAdmin) {
    return { ok: false, missing: REQUIRED_TABLES, checked: 0 };
  }
  const missing: string[] = [];
  for (const table of REQUIRED_TABLES) {
    const { error } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
    if (error && (error.code === '42P01' || error.message.toLowerCase().includes('does not exist'))) {
      missing.push(table);
    }
  }
  return { ok: missing.length === 0, missing, checked: REQUIRED_TABLES.length };
}

async function main() {
  const statusOnly = process.argv.includes('--status');
  const migrations = getMigrationFiles();
  const databaseUrl = process.env.DATABASE_URL || '';
  const hasDatabaseUrl = Boolean(databaseUrl && !databaseUrl.includes('MY_'));

  console.log('=== Midnight Poker Club — Supabase Setup & Verification ===');
  console.log(`Migrations found: ${migrations.map((m) => path.basename(m)).join(', ') || 'none'}`);
  console.log(`VITE_SUPABASE_URL / SUPABASE_URL: ${hasSupabaseUrl ? 'configured' : 'not set'}`);
  console.log(`Public Key (VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY): ${hasSupabasePublicKey ? 'configured' : 'not set'}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY (server-only): ${hasSupabaseServiceRole ? 'configured' : 'not set'}`);
  console.log(`DATABASE_URL: ${hasDatabaseUrl ? 'configured' : 'not set'}`);

  const mode = isSupabaseConfigured
    ? 'supabase-full'
    : isSupabaseAuthEnabled
      ? 'supabase-auth-only'
      : 'demo-preview-local-authoritative';
  console.log(`Runtime Mode: ${mode}`);

  if (!isSupabaseAuthEnabled && !hasDatabaseUrl) {
    console.log('\nNo live Supabase credentials detected — app runs in playable Demo/Preview mode with full server-authoritative gameplay.');
    console.log('To enable persistent Supabase Postgres & Google/Email Auth:');
    console.log('  1. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY), plus SUPABASE_SERVICE_ROLE_KEY in Secrets.');
    console.log('  2. Optionally set DATABASE_URL and run `npm run db:setup`, OR execute supabase/migrations/001_*.sql, 002_*.sql & 003_*.sql in Supabase SQL Editor.');
    return;
  }

  if (!statusOnly && hasDatabaseUrl) {
    if (hasPsqlBinary()) {
      console.log('\nApplying SQL migrations via psql...');
      for (const filePath of migrations) {
        console.log(`  -> Executing ${path.basename(filePath)}`);
        execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', filePath], {
          stdio: 'inherit',
        });
      }
      console.log('All migrations applied successfully.');
    } else {
      console.log('\npsql binary is not installed in this container; skipping direct PostgreSQL execution.');
    }
  }

  if (isSupabaseConfigured) {
    console.log('\nVerifying schema tables via Supabase Admin API...');
    const check = await verifyTablesViaSupabaseApi();
    if (check.ok) {
      console.log(`Verified ${check.checked}/${check.checked} tables exist and are reachable.`);
    } else {
      console.log(`Missing or unreachable tables (${check.missing.length}): ${check.missing.join(', ')}`);
      console.log('Run supabase/migrations/001_initial_schema.sql, 002_realtime_and_atomic_table_rpc.sql, and 003_supabase_auth_self_bootstrap.sql in your Supabase SQL Editor.');
      if (!statusOnly) {
        process.exitCode = 1;
      }
    }
  } else if (isSupabaseAuthEnabled) {
    console.log('\nSupabase Auth + RLS user persistence is active. Make sure migrations 001, 002, and 003 are applied in Supabase SQL Editor. Add SUPABASE_SERVICE_ROLE_KEY for server-wide admin queries.');
  }
}

main().catch((err) => {
  console.error('Database setup script failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
