-- MIDNIGHT POKER CLUB — Supabase Auth Auto-Profile Bootstrap, Username Check & Self-Service RPCs
-- Idempotent migration safe to run repeatedly on Supabase SQL Editor / CLI

-- 0. Ensure schema & table privileges + missing columns exist on pre-existing Supabase projects
GRANT USAGE ON SCHEMA public TO anon, authenticated;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_id TEXT NOT NULL DEFAULT 'ace-spade',
  ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player',
  ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
  ADD COLUMN IF NOT EXISTS sound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS music_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sfx_volume REAL NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS music_volume REAL NOT NULL DEFAULT 0.3,
  ADD COLUMN IF NOT EXISTS reduced_animations BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS preferred_speed TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

GRANT SELECT ON public.profiles, public.player_statistics, public.achievements, public.app_settings, public.tournament_results TO anon, authenticated;
GRANT UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.player_wallets, public.chip_transactions, public.daily_bonus_claims, public.game_rooms, public.room_members, public.poker_hands, public.poker_hand_actions, public.poker_hand_results, public.blackjack_rounds, public.blackjack_hands, public.tournaments, public.tournament_players, public.friendships, public.friend_requests, public.chat_messages, public.notifications, public.game_history, public.moderation_reports TO authenticated;
GRANT UPDATE ON public.notifications TO authenticated;

-- 1. Upgrade handle_new_user() trigger to preserve chosen username, Google display name, and avatarId,
--    and grant 5,000 virtual welcome chips exactly once.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_name TEXT;
  final_name TEXT;
  chosen_avatar TEXT;
  welcome_tx_exists BOOLEAN;
BEGIN
  base_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'username'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''),
    split_part(COALESCE(NEW.email, 'player'), '@', 1)
  );
  base_name := regexp_replace(base_name, '[^a-zA-Z0-9_]', '', 'g');
  IF char_length(base_name) < 3 THEN
    base_name := 'Player_' || substr(replace(NEW.id::text, '-', ''), 1, 6);
  END IF;
  final_name := left(base_name, 18);

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = lower(final_name) AND id <> NEW.id
  ) THEN
    final_name := left(base_name, 14) || '_' || substr(replace(NEW.id::text, '-', ''), 1, 4);
  END IF;

  chosen_avatar := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'avatarId'), ''), 'ace-spade');

  INSERT INTO public.profiles (id, username, avatar_id)
  VALUES (NEW.id, final_name, chosen_avatar)
  ON CONFLICT (id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1 FROM public.chip_transactions
    WHERE idempotency_key = 'welcome:' || NEW.id::text
  ) INTO welcome_tx_exists;

  IF NOT welcome_tx_exists THEN
    INSERT INTO public.player_wallets (user_id, chip_balance, welcome_bonus_claimed, welcome_claimed_at)
    VALUES (NEW.id, 5000, TRUE, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET chip_balance = CASE
            WHEN public.player_wallets.welcome_bonus_claimed = FALSE THEN public.player_wallets.chip_balance + 5000
            ELSE public.player_wallets.chip_balance
          END,
          welcome_bonus_claimed = TRUE,
          welcome_claimed_at = COALESCE(public.player_wallets.welcome_claimed_at, NOW());

    INSERT INTO public.chip_transactions (user_id, amount, balance_after, tx_type, idempotency_key, description)
    VALUES (NEW.id, 5000, 5000, 'welcome_bonus', 'welcome:' || NEW.id::text, 'One-time 5,000 virtual chip welcome bonus')
    ON CONFLICT (idempotency_key) DO NOTHING;
  ELSE
    INSERT INTO public.player_wallets (user_id, chip_balance, welcome_bonus_claimed, welcome_claimed_at)
    VALUES (NEW.id, 0, TRUE, NOW())
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

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

-- 2. Public username uniqueness check RPC (callable safely before signup)
CREATE OR REPLACE FUNCTION public.check_username_available(
  p_username TEXT,
  p_exclude_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean TEXT;
BEGIN
  v_clean := trim(COALESCE(p_username, ''));
  IF char_length(v_clean) < 3 OR char_length(v_clean) > 24 OR v_clean !~ '^[a-zA-Z0-9_]+$' THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = lower(v_clean)
      AND (p_exclude_user_id IS NULL OR id <> p_exclude_user_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_username_available(TEXT, UUID) TO anon, authenticated;

-- 3. Idempotent self-bootstrap RPC for authenticated users (creates profile, 5,000 welcome chips once, stats)
CREATE OR REPLACE FUNCTION public.bootstrap_player_profile(
  p_username TEXT DEFAULT NULL,
  p_avatar_id TEXT DEFAULT 'ace-spade'
)
RETURNS TABLE(
  user_id UUID,
  username TEXT,
  avatar_id TEXT,
  chip_balance BIGINT,
  welcome_bonus_claimed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_email TEXT;
  v_raw_meta JSONB;
  v_base TEXT;
  v_final TEXT;
  v_avatar TEXT;
  v_welcome_exists BOOLEAN;
  v_bal BIGINT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT u.email, u.raw_user_meta_data INTO v_email, v_raw_meta
  FROM auth.users u
  WHERE u.id = v_uid;

  v_base := COALESCE(
    NULLIF(trim(p_username), ''),
    NULLIF(trim(v_raw_meta->>'username'), ''),
    NULLIF(trim(v_raw_meta->>'full_name'), ''),
    NULLIF(trim(v_raw_meta->>'name'), ''),
    split_part(COALESCE(v_email, 'player'), '@', 1)
  );
  v_base := regexp_replace(v_base, '[^a-zA-Z0-9_]', '', 'g');
  IF char_length(v_base) < 3 THEN
    v_base := 'Player_' || substr(replace(v_uid::text, '-', ''), 1, 6);
  END IF;
  v_final := left(v_base, 18);

  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE lower(p.username) = lower(v_final) AND p.id <> v_uid
  ) THEN
    v_final := left(v_base, 14) || '_' || substr(replace(v_uid::text, '-', ''), 1, 4);
  END IF;

  v_avatar := COALESCE(
    NULLIF(trim(p_avatar_id), ''),
    NULLIF(trim(v_raw_meta->>'avatarId'), ''),
    'ace-spade'
  );

  INSERT INTO public.profiles (id, username, avatar_id)
  VALUES (v_uid, v_final, v_avatar)
  ON CONFLICT (id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1 FROM public.chip_transactions ct
    WHERE ct.idempotency_key = 'welcome:' || v_uid::text
  ) INTO v_welcome_exists;

  IF NOT v_welcome_exists THEN
    INSERT INTO public.player_wallets (user_id, chip_balance, welcome_bonus_claimed, welcome_claimed_at)
    VALUES (v_uid, 5000, TRUE, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET chip_balance = CASE
            WHEN public.player_wallets.welcome_bonus_claimed = FALSE THEN public.player_wallets.chip_balance + 5000
            ELSE public.player_wallets.chip_balance
          END,
          welcome_bonus_claimed = TRUE,
          welcome_claimed_at = COALESCE(public.player_wallets.welcome_claimed_at, NOW());

    SELECT pw.chip_balance INTO v_bal FROM public.player_wallets pw WHERE pw.user_id = v_uid;

    INSERT INTO public.chip_transactions (user_id, amount, balance_after, tx_type, idempotency_key, description)
    VALUES (v_uid, 5000, COALESCE(v_bal, 5000), 'welcome_bonus', 'welcome:' || v_uid::text, 'One-time 5,000 virtual chip welcome bonus')
    ON CONFLICT (idempotency_key) DO NOTHING;
  ELSE
    INSERT INTO public.player_wallets (user_id, chip_balance, welcome_bonus_claimed, welcome_claimed_at)
    VALUES (v_uid, 0, TRUE, NOW())
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  INSERT INTO public.player_statistics (user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN QUERY
  SELECT p.id, p.username, p.avatar_id, pw.chip_balance, pw.welcome_bonus_claimed
  FROM public.profiles p
  JOIN public.player_wallets pw ON pw.user_id = p.id
  WHERE p.id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bootstrap_player_profile(TEXT, TEXT) TO authenticated;

-- 4. Self-scoped Daily Bonus claim wrapper (uses auth.uid() so RLS stays protected)
CREATE OR REPLACE FUNCTION public.claim_daily_bonus_self()
RETURNS TABLE(claimed BOOLEAN, new_balance BIGINT, next_claim_at TIMESTAMPTZ, streak INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  RETURN QUERY SELECT * FROM public.claim_daily_bonus(v_uid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_daily_bonus_self() TO authenticated;

-- 5. Self-scoped statistics & game history persistence RPC (never grants arbitrary wallet chips)
CREATE OR REPLACE FUNCTION public.record_my_game_result(
  p_game_type TEXT,
  p_room_name TEXT,
  p_net_chips BIGINT,
  p_summary TEXT,
  p_hand_won BOOLEAN DEFAULT FALSE,
  p_is_blackjack BOOLEAN DEFAULT FALSE,
  p_xp_gain INTEGER DEFAULT 12
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_new_xp INTEGER;
  v_new_level INTEGER;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.game_history (user_id, game_type, room_name, net_chips, summary)
  VALUES (v_uid, p_game_type, left(p_room_name, 64), p_net_chips, left(p_summary, 240));

  INSERT INTO public.player_statistics (user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  IF p_game_type = 'holdem' OR p_game_type = 'tournament' THEN
    UPDATE public.player_statistics
    SET poker_hands_played = poker_hands_played + 1,
        poker_hands_won = poker_hands_won + CASE WHEN p_hand_won THEN 1 ELSE 0 END,
        total_games_played = total_games_played + 1,
        updated_at = NOW()
    WHERE user_id = v_uid;
  ELSIF p_game_type = 'blackjack' THEN
    UPDATE public.player_statistics
    SET blackjack_hands_played = blackjack_hands_played + 1,
        blackjack_hands_won = blackjack_hands_won + CASE WHEN p_hand_won THEN 1 ELSE 0 END,
        blackjack_blackjacks = blackjack_blackjacks + CASE WHEN p_is_blackjack THEN 1 ELSE 0 END,
        total_games_played = total_games_played + 1,
        updated_at = NOW()
    WHERE user_id = v_uid;
  END IF;

  UPDATE public.profiles
  SET xp = xp + GREATEST(0, LEAST(p_xp_gain, 250)),
      level = GREATEST(1, ((xp + GREATEST(0, LEAST(p_xp_gain, 250))) / 250) + 1),
      last_seen_at = NOW(),
      updated_at = NOW()
  WHERE id = v_uid
  RETURNING xp, level INTO v_new_xp, v_new_level;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_my_game_result(TEXT, TEXT, BIGINT, TEXT, BOOLEAN, BOOLEAN, INTEGER) TO authenticated;
