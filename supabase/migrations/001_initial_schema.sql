-- NEON POKER CLUB — Complete Supabase PostgreSQL Schema & Atomic Chip Functions
-- Idempotent migration safe to run repeatedly on Supabase SQL Editor / CLI

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE CHECK (char_length(username) BETWEEN 3 AND 24),
  avatar_id TEXT NOT NULL DEFAULT 'ace-spade',
  bio TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'moderator', 'admin')),
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_reason TEXT,
  sound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  music_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sfx_volume REAL NOT NULL DEFAULT 0.75 CHECK (sfx_volume >= 0 AND sfx_volume <= 1),
  music_volume REAL NOT NULL DEFAULT 0.3 CHECK (music_volume >= 0 AND music_volume <= 1),
  reduced_animations BOOLEAN NOT NULL DEFAULT FALSE,
  preferred_speed TEXT NOT NULL DEFAULT 'normal' CHECK (preferred_speed IN ('relaxed', 'normal', 'fast')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. PLAYER WALLETS (Wallet chips strictly separated from table stacks & tournament chips)
CREATE TABLE IF NOT EXISTS public.player_wallets (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  chip_balance BIGINT NOT NULL DEFAULT 0 CHECK (chip_balance >= 0),
  welcome_bonus_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  welcome_claimed_at TIMESTAMPTZ,
  lifetime_won BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_won >= 0),
  lifetime_lost BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_lost >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. CHIP TRANSACTIONS (Immutable Audit Ledger)
CREATE TABLE IF NOT EXISTS public.chip_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL,
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  tx_type TEXT NOT NULL CHECK (tx_type IN (
    'welcome_bonus', 'daily_bonus', 'table_buyin', 'table_cashout',
    'poker_win', 'poker_loss', 'blackjack_bet', 'blackjack_payout',
    'tournament_buyin', 'tournament_payout', 'friend_gift_sent', 'friend_gift_received',
    'admin_adjustment'
  )),
  reference_id TEXT,
  idempotency_key TEXT UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. DAILY BONUS CLAIMS
CREATE TABLE IF NOT EXISTS public.daily_bonus_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL DEFAULT 2000 CHECK (amount > 0),
  streak_count INTEGER NOT NULL DEFAULT 1,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. GAME ROOMS
CREATE TABLE IF NOT EXISTS public.game_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (char_length(code) = 6),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 48),
  game_type TEXT NOT NULL CHECK (game_type IN ('holdem', 'blackjack')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  password_hash TEXT,
  host_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  max_players INTEGER NOT NULL CHECK (max_players BETWEEN 2 AND 9),
  small_blind BIGINT NOT NULL DEFAULT 25 CHECK (small_blind > 0),
  big_blind BIGINT NOT NULL DEFAULT 50 CHECK (big_blind >= small_blind * 2),
  min_buyin BIGINT NOT NULL DEFAULT 500 CHECK (min_buyin > 0),
  max_buyin BIGINT NOT NULL DEFAULT 5000 CHECK (max_buyin >= min_buyin),
  game_speed TEXT NOT NULL DEFAULT 'normal' CHECK (game_speed IN ('relaxed', 'normal', 'fast')),
  allow_probability_assist BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'closed')),
  tournament_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. ROOM MEMBERS
CREATE TABLE IF NOT EXISTS public.room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seat_index INTEGER NOT NULL CHECK (seat_index >= 0 AND seat_index < 9),
  table_stack BIGINT NOT NULL DEFAULT 0 CHECK (table_stack >= 0),
  status TEXT NOT NULL DEFAULT 'seated' CHECK (status IN ('seated', 'playing', 'sitting_out', 'disconnected', 'left')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, user_id),
  UNIQUE (room_id, seat_index)
);

-- 7. POKER HANDS
CREATE TABLE IF NOT EXISTS public.poker_hands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  hand_number INTEGER NOT NULL,
  dealer_seat INTEGER NOT NULL,
  small_blind BIGINT NOT NULL,
  big_blind BIGINT NOT NULL,
  community_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_pot BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 8. POKER HAND ACTIONS
CREATE TABLE IF NOT EXISTS public.poker_hand_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id UUID NOT NULL REFERENCES public.poker_hands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  street TEXT NOT NULL CHECK (street IN ('preflop', 'flop', 'turn', 'river')),
  action_type TEXT NOT NULL CHECK (action_type IN ('post_sb', 'post_bb', 'fold', 'check', 'call', 'bet', 'raise', 'all_in')),
  amount BIGINT NOT NULL DEFAULT 0,
  sequence_num INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. POKER HAND RESULTS
CREATE TABLE IF NOT EXISTS public.poker_hand_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id UUID NOT NULL REFERENCES public.poker_hands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  net_chips BIGINT NOT NULL,
  won_pot BIGINT NOT NULL DEFAULT 0,
  hand_category TEXT,
  hand_description TEXT,
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. BLACKJACK ROUNDS
CREATE TABLE IF NOT EXISTS public.blackjack_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  dealer_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
  dealer_score INTEGER,
  status TEXT NOT NULL DEFAULT 'betting' CHECK (status IN ('betting', 'active', 'settled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

-- 11. BLACKJACK HANDS
CREATE TABLE IF NOT EXISTS public.blackjack_hands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES public.blackjack_rounds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  hand_index INTEGER NOT NULL DEFAULT 0,
  cards JSONB NOT NULL DEFAULT '[]'::jsonb,
  bet_amount BIGINT NOT NULL CHECK (bet_amount > 0),
  insurance_bet BIGINT NOT NULL DEFAULT 0,
  payout BIGINT NOT NULL DEFAULT 0,
  outcome TEXT CHECK (outcome IN ('blackjack', 'win', 'push', 'lose', 'bust')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. TOURNAMENTS (Single-table Texas Hold'em Sit & Go / Scheduled)
CREATE TABLE IF NOT EXISTS public.tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (char_length(code) = 6),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  max_players INTEGER NOT NULL DEFAULT 8 CHECK (max_players BETWEEN 2 AND 9),
  starting_chips BIGINT NOT NULL DEFAULT 5000 CHECK (starting_chips >= 500),
  starting_sb BIGINT NOT NULL DEFAULT 25 CHECK (starting_sb > 0),
  starting_bb BIGINT NOT NULL DEFAULT 50 CHECK (starting_bb >= starting_sb * 2),
  blind_interval_minutes INTEGER NOT NULL DEFAULT 10 CHECK (blind_interval_minutes BETWEEN 1 AND 60),
  blind_schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
  ante_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  entry_fee BIGINT NOT NULL DEFAULT 0 CHECK (entry_fee >= 0),
  allow_probability_assist BOOLEAN NOT NULL DEFAULT TRUE,
  game_speed TEXT NOT NULL DEFAULT 'normal' CHECK (game_speed IN ('relaxed', 'normal', 'fast')),
  start_condition TEXT NOT NULL DEFAULT 'host_or_full' CHECK (start_condition IN ('auto_when_full', 'host_or_full')),
  status TEXT NOT NULL DEFAULT 'registering' CHECK (status IN ('registering', 'in_progress', 'completed', 'cancelled')),
  current_level INTEGER NOT NULL DEFAULT 1,
  level_started_at TIMESTAMPTZ,
  room_id UUID REFERENCES public.game_rooms(id) ON DELETE SET NULL,
  winner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- 13. TOURNAMENT PLAYERS
CREATE TABLE IF NOT EXISTS public.tournament_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tournament_chips BIGINT NOT NULL DEFAULT 5000 CHECK (tournament_chips >= 0),
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'active', 'eliminated', 'winner')),
  placement INTEGER,
  eliminated_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, user_id)
);

-- 14. TOURNAMENT RESULTS
CREATE TABLE IF NOT EXISTS public.tournament_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  placement INTEGER NOT NULL CHECK (placement >= 1),
  prize_chips BIGINT NOT NULL DEFAULT 0,
  hands_played INTEGER NOT NULL DEFAULT 0,
  players_eliminated INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. FRIENDSHIPS
CREATE TABLE IF NOT EXISTS public.friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_a < user_b),
  UNIQUE (user_a, user_b)
);

-- 16. FRIEND REQUESTS
CREATE TABLE IF NOT EXISTS public.friend_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CHECK (sender_id <> receiver_id)
);

-- 17. CHAT MESSAGES
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_type TEXT NOT NULL CHECK (channel_type IN ('room', 'tournament', 'direct', 'global')),
  channel_id TEXT NOT NULL,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  is_emote BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 18. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notif_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19. GAME HISTORY
CREATE TABLE IF NOT EXISTS public.game_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL CHECK (game_type IN ('holdem', 'blackjack', 'tournament')),
  room_name TEXT NOT NULL,
  net_chips BIGINT NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 20. PLAYER STATISTICS
CREATE TABLE IF NOT EXISTS public.player_statistics (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  poker_hands_played INTEGER NOT NULL DEFAULT 0,
  poker_hands_won INTEGER NOT NULL DEFAULT 0,
  tournaments_played INTEGER NOT NULL DEFAULT 0,
  tournaments_won INTEGER NOT NULL DEFAULT 0,
  blackjack_hands_played INTEGER NOT NULL DEFAULT 0,
  blackjack_hands_won INTEGER NOT NULL DEFAULT 0,
  blackjack_blackjacks INTEGER NOT NULL DEFAULT 0,
  total_games_played INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 21. ACHIEVEMENTS
CREATE TABLE IF NOT EXISTS public.achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, badge_key)
);

-- 22. MODERATION REPORTS
CREATE TABLE IF NOT EXISTS public.moderation_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  room_id UUID REFERENCES public.game_rooms(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  resolution_notes TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_chip_tx_user_created ON public.chip_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_bonus_user_claimed ON public.daily_bonus_claims(user_id, claimed_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_rooms_visibility_status ON public.game_rooms(visibility, status);
CREATE INDEX IF NOT EXISTS idx_room_members_room ON public.room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON public.chat_messages(channel_type, channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_history_user_created ON public.game_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON public.tournaments(status, created_at DESC);

-- ROW LEVEL SECURITY
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chip_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_bonus_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poker_hands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poker_hand_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poker_hand_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blackjack_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blackjack_hands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_reports ENABLE ROW LEVEL SECURITY;

-- Policies: Users can read public profiles & stats, own wallet/tx/notifications/history; NO direct wallet UPDATE/INSERT by client!
DO $$ BEGIN
  CREATE POLICY "profiles_public_read" ON public.profiles FOR SELECT USING (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "wallets_self_read" ON public.player_wallets FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "chip_tx_self_read" ON public.chip_transactions FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "notifications_self_read" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "notifications_self_update" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "history_self_read" ON public.game_history FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "stats_public_read" ON public.player_statistics FOR SELECT USING (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "achievements_public_read" ON public.achievements FOR SELECT USING (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "rooms_public_read" ON public.game_rooms FOR SELECT USING (visibility = 'public' OR host_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "tournaments_public_read" ON public.tournaments FOR SELECT USING (visibility = 'public' OR creator_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ATOMIC SERVER-SIDE POSTGRESQL FUNCTIONS (Privileged SECURITY DEFINER)

-- 1. Automatic new user bootstrap trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_name TEXT;
  final_name TEXT;
BEGIN
  base_name := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(COALESCE(NEW.email, 'player'), '@', 1)
  );
  base_name := regexp_replace(base_name, '[^a-zA-Z0-9_]', '', 'g');
  IF char_length(base_name) < 3 THEN
    base_name := 'Player_' || substr(NEW.id::text, 1, 6);
  END IF;
  final_name := left(base_name, 18);
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(final_name)) THEN
    final_name := left(base_name, 14) || '_' || substr(NEW.id::text, 1, 4);
  END IF;

  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, final_name)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.player_wallets (user_id, chip_balance, welcome_bonus_claimed, welcome_claimed_at)
  VALUES (NEW.id, 5000, TRUE, NOW())
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.chip_transactions (user_id, amount, balance_after, tx_type, idempotency_key, description)
  VALUES (NEW.id, 5000, 5000, 'welcome_bonus', 'welcome:' || NEW.id::text, 'Welcome bonus virtual chips')
  ON CONFLICT (idempotency_key) DO NOTHING;

  INSERT INTO public.player_statistics (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Atomic Daily 2,000-Chip Claim (once per 24 hours)
CREATE OR REPLACE FUNCTION public.claim_daily_bonus(p_user_id UUID)
RETURNS TABLE(claimed BOOLEAN, new_balance BIGINT, next_claim_at TIMESTAMPTZ, streak INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_claim TIMESTAMPTZ;
  v_streak INTEGER := 1;
  v_balance BIGINT;
BEGIN
  SELECT claimed_at, streak_count INTO v_last_claim, v_streak
  FROM public.daily_bonus_claims
  WHERE user_id = p_user_id
  ORDER BY claimed_at DESC
  LIMIT 1;

  IF v_last_claim IS NOT NULL AND v_last_claim > NOW() - INTERVAL '24 hours' THEN
    SELECT chip_balance INTO v_balance FROM public.player_wallets WHERE user_id = p_user_id;
    RETURN QUERY SELECT FALSE, COALESCE(v_balance, 0), v_last_claim + INTERVAL '24 hours', COALESCE(v_streak, 1);
    RETURN;
  END IF;

  IF v_last_claim IS NOT NULL AND v_last_claim > NOW() - INTERVAL '48 hours' THEN
    v_streak := COALESCE(v_streak, 0) + 1;
  ELSE
    v_streak := 1;
  END IF;

  UPDATE public.player_wallets
  SET chip_balance = chip_balance + 2000, version = version + 1, updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING chip_balance INTO v_balance;

  INSERT INTO public.daily_bonus_claims (user_id, amount, streak_count)
  VALUES (p_user_id, 2000, v_streak);

  INSERT INTO public.chip_transactions (user_id, amount, balance_after, tx_type, description)
  VALUES (p_user_id, 2000, v_balance, 'daily_bonus', 'Daily 2,000 virtual chip refill');

  RETURN QUERY SELECT TRUE, v_balance, NOW() + INTERVAL '24 hours', v_streak;
END;
$$;

-- 3. Atomic Friend Chip Transfer
CREATE OR REPLACE FUNCTION public.transfer_chips_atomic(
  p_sender_id UUID,
  p_receiver_id UUID,
  p_amount BIGINT,
  p_idempotency_key TEXT
)
RETURNS TABLE(success BOOLEAN, sender_balance BIGINT, receiver_balance BIGINT, error_msg TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_bal BIGINT;
  v_receiver_bal BIGINT;
BEGIN
  IF p_amount <= 0 OR p_amount > 10000 THEN
    RETURN QUERY SELECT FALSE, 0::BIGINT, 0::BIGINT, 'Transfer amount must be between 1 and 10,000 chips';
    RETURN;
  END IF;

  IF p_sender_id = p_receiver_id THEN
    RETURN QUERY SELECT FALSE, 0::BIGINT, 0::BIGINT, 'Cannot transfer chips to yourself';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.chip_transactions WHERE idempotency_key = p_idempotency_key) THEN
    SELECT chip_balance INTO v_sender_bal FROM public.player_wallets WHERE user_id = p_sender_id;
    SELECT chip_balance INTO v_receiver_bal FROM public.player_wallets WHERE user_id = p_receiver_id;
    RETURN QUERY SELECT TRUE, v_sender_bal, v_receiver_bal, NULL::TEXT;
    RETURN;
  END IF;

  -- Lock wallets in deterministic UUID order to prevent deadlocks
  IF p_sender_id < p_receiver_id THEN
    PERFORM 1 FROM public.player_wallets WHERE user_id IN (p_sender_id, p_receiver_id) ORDER BY user_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.player_wallets WHERE user_id IN (p_receiver_id, p_sender_id) ORDER BY user_id FOR UPDATE;
  END IF;

  UPDATE public.player_wallets
  SET chip_balance = chip_balance - p_amount, version = version + 1, updated_at = NOW()
  WHERE user_id = p_sender_id AND chip_balance >= p_amount
  RETURNING chip_balance INTO v_sender_bal;

  IF v_sender_bal IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::BIGINT, 0::BIGINT, 'Insufficient virtual chips';
    RETURN;
  END IF;

  UPDATE public.player_wallets
  SET chip_balance = chip_balance + p_amount, version = version + 1, updated_at = NOW()
  WHERE user_id = p_receiver_id
  RETURNING chip_balance INTO v_receiver_bal;

  INSERT INTO public.chip_transactions (user_id, amount, balance_after, tx_type, reference_id, idempotency_key, description)
  VALUES
    (p_sender_id, -p_amount, v_sender_bal, 'friend_gift_sent', p_receiver_id::text, p_idempotency_key || ':out', 'Virtual chip gift sent to friend'),
    (p_receiver_id, p_amount, v_receiver_bal, 'friend_gift_received', p_sender_id::text, p_idempotency_key || ':in', 'Virtual chip gift received from friend');

  RETURN QUERY SELECT TRUE, v_sender_bal, v_receiver_bal, NULL::TEXT;
END;
$$;
