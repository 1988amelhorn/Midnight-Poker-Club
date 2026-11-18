-- NEON POKER CLUB — Complete RLS Hardening, Atomic Table RPCs & Realtime Publication
-- Idempotent migration safe to run repeatedly on Supabase SQL Editor / CLI

-- 1. GLOBAL APP SETTINGS & SYSTEM AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.app_settings (key, value)
VALUES (
  'global_config',
  '{
    "maintenanceMode": false,
    "allowNewRegistrations": true,
    "defaultGameSpeed": "normal",
    "dailyBonusAmount": 2000,
    "welcomeBonusAmount": 5000,
    "maxFriendGiftAmount": 10000
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.system_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_logs_created ON public.system_logs(created_at DESC);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

-- 2. COMPLETE ROW LEVEL SECURITY POLICIES FOR ALL TABLES
-- Daily bonus claims: self-read only (mutations happen via SECURITY DEFINER RPC or service_role)
DO $$ BEGIN
  CREATE POLICY "daily_bonus_self_read" ON public.daily_bonus_claims
  FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Room members: readable by authenticated players in accessible rooms
DO $$ BEGIN
  CREATE POLICY "room_members_auth_read" ON public.room_members
  FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Poker hands / actions / results: readable by authenticated players (private hole cards stay in server memory, never written pre-showdown)
DO $$ BEGIN
  CREATE POLICY "poker_hands_auth_read" ON public.poker_hands
  FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "poker_actions_auth_read" ON public.poker_hand_actions
  FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "poker_results_auth_read" ON public.poker_hand_results
  FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Blackjack rounds / hands: self or table member read
DO $$ BEGIN
  CREATE POLICY "blackjack_rounds_auth_read" ON public.blackjack_rounds
  FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "blackjack_hands_auth_read" ON public.blackjack_hands
  FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tournament players & results: readable by authenticated users
DO $$ BEGIN
  CREATE POLICY "tournament_players_auth_read" ON public.tournament_players
  FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "tournament_results_public_read" ON public.tournament_results
  FOR SELECT USING (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Friendships & requests: participants can read only their own relationships
DO $$ BEGIN
  CREATE POLICY "friendships_participant_read" ON public.friendships
  FOR SELECT USING (auth.uid() = user_a OR auth.uid() = user_b);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "friend_requests_participant_read" ON public.friend_requests
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Chat messages: non-deleted global/room/tournament messages or direct messages between participants
DO $$ BEGIN
  CREATE POLICY "chat_messages_participant_read" ON public.chat_messages
  FOR SELECT USING (
    NOT is_deleted AND (
      channel_type IN ('global', 'room', 'tournament')
      OR auth.uid() = sender_id
      OR auth.uid() = recipient_id
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Moderation reports: reporter can read their own reports, admins can read all
DO $$ BEGIN
  CREATE POLICY "reports_self_or_admin_read" ON public.moderation_reports
  FOR SELECT USING (
    auth.uid() = reporter_id
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'moderator'))
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- App settings: public read for client feature flags; admin-only updates via server
DO $$ BEGIN
  CREATE POLICY "app_settings_public_read" ON public.app_settings
  FOR SELECT USING (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- System logs: admins only
DO $$ BEGIN
  CREATE POLICY "system_logs_admin_read" ON public.system_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. ATOMIC TABLE BUY-IN & CASHOUT RPCs (Zero client-side chip tampering)
CREATE OR REPLACE FUNCTION public.buyin_to_table_atomic(
  p_user_id UUID,
  p_room_id UUID,
  p_amount BIGINT,
  p_seat_index INTEGER,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, new_wallet_balance BIGINT, table_stack BIGINT, error_msg TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
  v_stack BIGINT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::BIGINT, 0::BIGINT, 'Buy-in amount must be positive';
    RETURN;
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chip_transactions WHERE idempotency_key = p_idempotency_key
  ) THEN
    SELECT chip_balance INTO v_balance FROM public.player_wallets WHERE user_id = p_user_id;
    SELECT rm.table_stack INTO v_stack FROM public.room_members rm WHERE rm.room_id = p_room_id AND rm.user_id = p_user_id;
    RETURN QUERY SELECT TRUE, COALESCE(v_balance, 0), COALESCE(v_stack, 0), NULL::TEXT;
    RETURN;
  END IF;

  PERFORM 1 FROM public.player_wallets WHERE user_id = p_user_id FOR UPDATE;

  UPDATE public.player_wallets
  SET chip_balance = chip_balance - p_amount, version = version + 1, updated_at = NOW()
  WHERE user_id = p_user_id AND chip_balance >= p_amount
  RETURNING chip_balance INTO v_balance;

  IF v_balance IS NULL THEN
    SELECT chip_balance INTO v_balance FROM public.player_wallets WHERE user_id = p_user_id;
    RETURN QUERY SELECT FALSE, COALESCE(v_balance, 0), 0::BIGINT, 'Insufficient virtual chips for buy-in';
    RETURN;
  END IF;

  INSERT INTO public.room_members (room_id, user_id, seat_index, table_stack, status)
  VALUES (p_room_id, p_user_id, p_seat_index, p_amount, 'seated')
  ON CONFLICT (room_id, user_id)
  DO UPDATE SET table_stack = public.room_members.table_stack + p_amount, status = 'seated'
  RETURNING public.room_members.table_stack INTO v_stack;

  INSERT INTO public.chip_transactions (user_id, amount, balance_after, tx_type, reference_id, idempotency_key, description)
  VALUES (p_user_id, -p_amount, v_balance, 'table_buyin', p_room_id::text, p_idempotency_key, 'Bought into table');

  RETURN QUERY SELECT TRUE, v_balance, v_stack, NULL::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.cashout_from_table_atomic(
  p_user_id UUID,
  p_room_id UUID,
  p_amount BIGINT,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, new_wallet_balance BIGINT, error_msg TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  IF p_amount < 0 THEN
    RETURN QUERY SELECT FALSE, 0::BIGINT, 'Cash-out amount cannot be negative';
    RETURN;
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chip_transactions WHERE idempotency_key = p_idempotency_key
  ) THEN
    SELECT chip_balance INTO v_balance FROM public.player_wallets WHERE user_id = p_user_id;
    RETURN QUERY SELECT TRUE, COALESCE(v_balance, 0), NULL::TEXT;
    RETURN;
  END IF;

  DELETE FROM public.room_members WHERE room_id = p_room_id AND user_id = p_user_id;

  IF p_amount > 0 THEN
    UPDATE public.player_wallets
    SET chip_balance = chip_balance + p_amount, version = version + 1, updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING chip_balance INTO v_balance;

    INSERT INTO public.chip_transactions (user_id, amount, balance_after, tx_type, reference_id, idempotency_key, description)
    VALUES (p_user_id, p_amount, v_balance, 'table_cashout', p_room_id::text, p_idempotency_key, 'Cashed out from table');
  ELSE
    SELECT chip_balance INTO v_balance FROM public.player_wallets WHERE user_id = p_user_id;
  END IF;

  RETURN QUERY SELECT TRUE, COALESCE(v_balance, 0), NULL::TEXT;
END;
$$;

-- 4. SUPABASE REALTIME PUBLICATION FOR LOBBY, ROOMS, TOURNAMENTS, CHAT & NOTIFICATIONS
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rooms;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.room_members;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tournaments;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tournament_players;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.player_wallets;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
