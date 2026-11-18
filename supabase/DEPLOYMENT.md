# Neon Poker Club — Supabase & Production Deployment Guide

## 1. Create Your Supabase Project
1. Create a new project in [Supabase](https://supabase.com).
2. Open the **SQL Editor** and run in order:
   - `/supabase/migrations/001_initial_schema.sql`
   - `/supabase/migrations/002_realtime_and_atomic_table_rpc.sql`
   - `/supabase/migrations/003_supabase_auth_self_bootstrap.sql`
   (Or run `npm run db:setup` if `DATABASE_URL` and `psql` are configured.)
   - All three migrations are idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`) and safe to re-run without destroying existing player records.
3. In **Authentication → Providers**:
   - Enable **Email** (email confirmation & password recovery enabled).
   - Enable **Google** OAuth with your Google Cloud OAuth Client ID & Secret.
   - Under **Authentication → URL Configuration**, add your production `APP_URL`, preview URL, and `http://localhost:3000` to **Redirect URLs** (including `/**` wildcard if hosting multiple preview URLs).

## 2. Configure Environment Variables
Set these in your hosting environment (Cloud Run / Railway / Render / AI Studio Secrets):

- `VITE_SUPABASE_URL` — Project URL (`https://<project>.supabase.co`)
- `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY` — Public publishable / anon key
- `SUPABASE_URL` — Same Project URL (server-side, optional if `VITE_SUPABASE_URL` is set)
- `SUPABASE_SERVICE_ROLE_KEY` — Secret `service_role` key (**server-only**, never prefix with `VITE_`)
- `DATABASE_URL` — Optional direct PostgreSQL connection string for automated CLI migrations (`npm run db:setup`)
- `APP_URL` — Public HTTPS URL of your deployed app
- `SESSION_SECRET` — Strong random string (32+ chars)

## 3. Build & Run
```bash
npm install
npm run db:status
npm test
npm run lint
npm run build
npm start
```
The server listens on `PORT` (defaults to `3000`) and serves both the Express REST API, WebSocket multiplayer gateway (`/ws`), and the production Vite frontend bundle.

## 4. Database Backup & Operations
- Enable **Daily Point-in-Time Recovery (PITR) / Automated Backups** in Supabase Dashboard → Settings → Database.
- Before applying future schema migrations, export a logical snapshot:
  ```bash
  pg_dump "$DATABASE_URL" --schema=public --format=custom -f neon_poker_backup.dump
  ```
- Inspect `/api/health` (`{"status":"ok","supabaseConfigured":true,"supabaseAuthEnabled":true}`) to verify uptime and database connectivity.

