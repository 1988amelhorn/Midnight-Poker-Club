# Midnight Poker Club — Back4app Containers test backend

**Goal:** run the existing Node.js poker/blackjack backend on one WebSocket-capable process, rather than the independent Vercel functions that caused “Room not found.”

## Free-tier limitation (verified November 2026)

Back4app advertises a $0 container with 0.25 vCPU, 256 MB RAM and 100 GB transfer, and allows sign-up without a credit card.

**Important:** Back4app's updated September 2026 docs state that on the free tier, a **temporary URL expires after about 60 minutes per deploy**, and a permanent URL is on a paid tier. This is suitable for a short trial only. **Do not switch the live Vercel frontend** to the expiring URL. The current fail-safe continues protecting players from phantom rooms.

Source: https://www.back4app.com/blog/deploy-node-app-dockerfile-back4app

## Deploy a free test container (no card)

1. Sign up at https://www.back4app.com/signup-containers using GitHub.
2. Choose **Container**, then authorize the GitHub repository `1988amelhorn/Midnight-Poker-Club`.
3. Set branch **main**, root **/**, Dockerfile **Dockerfile**, and **Free** plan ($0). Do not choose a paid tier.
4. Environment variables (enter directly in the Back4app settings, never in GitHub or ChatGPT):
   - `PORT=8080`
   - `NODE_ENV=production`
   - `FRONTEND_ORIGIN=https://midnight-poker-club.vercel.app`
   - `APP_URL=https://midnight-poker-club.vercel.app`
   - `SUPABASE_URL` = current Supabase project URL.
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = **public** Supabase publishable key.
   - `SESSION_SECRET` = a randomly generated, long, private string.
   - `SUPABASE_SERVICE_ROLE_KEY` (optional for legacy admin routines): private key, **never** exposed to the browser or repository.
5. Deploy and confirm `https://<test-container-host>/api/health` responds with `multiplayerAvailable: true` and `multiplayerHosting: "single-process"`. Do not post secret environment values.
6. To run a real test, create a disposable frontend **preview** configured with `VITE_API_BASE_URL=https://<test-container-host>` and verify two independent signed-in players can see/join the *same* Hold'em and Blackjack rooms. Only then consider any launch planning.

## Important limits and safety

- No payment method and no paid plan is required for this **test** setup, but the short-lived URL is not appropriate for a reliable public game.
- The Node server's poker/blackjack engines and chip buy-ins still rely on in-memory state. A container restart can end games and compromise table-stack accounting. No game is launch-ready until buy-ins, payouts and active table state are durably synchronized with the live Supabase schema.
- The production Vercel app remains unchanged: its account/friends UI works, while unsafe serverless table joining is blocked.
- Never commit secrets, keys, or production environment files.
