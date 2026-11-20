# Midnight Poker Club: no-card multiplayer test host

## Why this exists
Vercel's serverless functions cannot retain a single shared Node poker engine across requests. A GET /api/rooms can run on a different instance from a later POST /api/rooms/join. That is why the live app intentionally keeps multiplayer disabled until a real game server is connected.

## No-card candidate: Enzonic's Node.js *Panel* Free tier
Provider page: https://enzonic.com/nodejs
Panel: https://panel.enzonic.com

Enzonic advertises one free Node.js server with 512 MB RAM, no payment card, a free subdomain and support for long-lived processes. Free provisioning is subject to capacity. This is the **Node.js server in the Panel**, not Enzonic Deploy's separate free server mode (which sleeps after 15 minutes). These are provider claims, not a verified uptime SLA.

## Deploy a test server
1. Sign up at https://panel.enzonic.com and choose a **Node.js server** on the **$0 / Free** plan. Do not select any paid service.
2. Connect your GitHub repository `1988amelhorn/Midnight-Poker-Club` to the server (or use the panel's file uploader). Select branch `main`.
3. Use Node.js 22 and assign the port supplied by the panel to the `PORT` environment variable (if it does not do so automatically).
4. Install and build: `npm install --no-audit --no-fund && npm run build`.
5. Startup command: `npm start`.
6. In **private server environment settings**, set the following (never commit or paste credentials in issues or chats):
   - `NODE_ENV=production`
   - `FRONTEND_ORIGIN=https://midnight-poker-club.vercel.app`
   - `APP_URL=https://midnight-poker-club.vercel.app`
   - `SUPABASE_URL`: the exact current Supabase project URL
   - `VITE_SUPABASE_URL`: the same Supabase URL for the client build
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: the existing public Supabase publishable key
   - `SESSION_SECRET`: a long unique random secret
   - `SUPABASE_SERVICE_ROLE_KEY`: only if needed for a verified feature; never use an elevated key in the frontend build
7. Open the Enzonic HTTPS app domain directly. Its /api/health should show `multiplayerAvailable: true` and `multiplayerHosting: single-process`. **Do not change production Vercel yet.**
8. Sign in as two separate users (two phones or separate browsers), create a public Hold'em table, join and play, cash out, repeat for Blackjack, then restart the server and verify no phantom tables appear.
9. Only after successful testing, decide whether to share the Enzonic domain or set `VITE_API_BASE_URL` on Vercel (which requires a frontend rebuild). If kept on separate origins, test authentication, CORS and WSS end to end.

## Remaining release risks
- Game stack and engine state still live in RAM on the single server. Restart/crash can lose an active hand and its table-chip state; the app is **not crash-safe** until game tables and buy-ins are durably stored and reconciled.
- Host idle limits, availability, and WebSocket proxy support must be tested on the actual free instance.
- Do not enable a pretend multiplayer mode on Vercel's stateless API. Keep the `GAME_SERVER_REQUIRED` safety behavior intact.
- The lobby only lists **player-created tables**; a table closes when its last human leaves.

Provider documentation as checked November 2026:
https://enzonic.com/nodejs
https://enzonic.dev/pricing/
