-- Available wallet + table reservations are persisted separately. Only signed
-- game-server events may change table funds; browser callers cannot award chips.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS daily_bonus_streak integer NOT NULL DEFAULT 0;
CREATE TABLE private.midnight_wallet_key (id boolean PRIMARY KEY DEFAULT true CHECK (id), secret text NOT NULL);
ALTER TABLE private.midnight_wallet_key ENABLE ROW LEVEL SECURITY;
INSERT INTO private.midnight_wallet_key(id,secret) VALUES(true,encode(extensions.gen_random_bytes(32),'hex'));
CREATE TABLE private.midnight_table_wallets (
 uid uuid NOT NULL REFERENCES public.profiles(uid) ON DELETE CASCADE,
 room_id text NOT NULL, process_id text NOT NULL, chips bigint NOT NULL CHECK(chips>=0),
 PRIMARY KEY(uid,room_id)
);
ALTER TABLE private.midnight_table_wallets ENABLE ROW LEVEL SECURITY;
CREATE TABLE private.midnight_wallet_events (nonce uuid PRIMARY KEY, uid uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE private.midnight_wallet_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.protect_profile_wallet_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role' AND (
  new.chips IS DISTINCT FROM old.chips OR new.last_reload_at IS DISTINCT FROM old.last_reload_at OR
  new.daily_bonus_streak IS DISTINCT FROM old.daily_bonus_streak OR
  new.total_hands_played IS DISTINCT FROM old.total_hands_played OR new.hands_won IS DISTINCT FROM old.hands_won OR
  new.tournament_wins IS DISTINCT FROM old.tournament_wins OR new.blackjack_wins IS DISTINCT FROM old.blackjack_wins OR
  new.lifetime_winnings IS DISTINCT FROM old.lifetime_winnings
 ) THEN RAISE EXCEPTION 'Virtual chip balances and game stats are server-controlled only.'; END IF;
 new.updated_at:=now(); RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.protect_profile_wallet_columns() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.midnight_wallet_snapshot()
RETURNS TABLE(chip_balance bigint,available_chips bigint,last_reload_at timestamptz,next_claim_at timestamptz,daily_streak integer)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT p.chips+coalesce((SELECT sum(t.chips) FROM private.midnight_table_wallets t WHERE t.uid=p.uid),0)::bigint,
 p.chips,p.last_reload_at,p.last_reload_at+interval '24 hours',p.daily_bonus_streak
 FROM public.profiles p WHERE p.uid=auth.uid()
$$;
REVOKE ALL ON FUNCTION private.midnight_wallet_snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.midnight_wallet_snapshot() TO authenticated;
CREATE FUNCTION public.get_midnight_wallet()
RETURNS TABLE(chip_balance bigint,available_chips bigint,last_reload_at timestamptz,next_claim_at timestamptz,daily_streak integer)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM private.midnight_wallet_snapshot() $$;
REVOKE ALL ON FUNCTION public.get_midnight_wallet() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_midnight_wallet() TO authenticated;

CREATE FUNCTION private.midnight_daily_bonus()
RETURNS TABLE(claimed boolean,new_balance bigint,available_balance bigint,next_claim_at timestamptz,streak integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); p public.profiles%ROWTYPE; v_role text; v_total bigint;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO p FROM public.profiles WHERE uid=v_uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Player wallet not found'; END IF;
 SELECT p.chips+coalesce(sum(t.chips),0)::bigint INTO v_total FROM private.midnight_table_wallets t WHERE t.uid=v_uid;
 IF p.last_reload_at > now()-interval '24 hours' THEN
  RETURN QUERY SELECT false,v_total,p.chips,p.last_reload_at+interval '24 hours',p.daily_bonus_streak; RETURN;
 END IF;
 p.daily_bonus_streak:=CASE WHEN p.last_reload_at>now()-interval '48 hours' THEN p.daily_bonus_streak+1 ELSE 1 END;
 v_role:=current_setting('request.jwt.claim.role',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 UPDATE public.profiles SET chips=chips+2000,last_reload_at=now(),daily_bonus_streak=p.daily_bonus_streak WHERE uid=v_uid RETURNING chips INTO p.chips;
 PERFORM set_config('request.jwt.claim.role',coalesce(v_role,''),true);
 INSERT INTO public.chip_ledger(uid,amount,balance_after,reason,game_id) VALUES(v_uid,2000,v_total+2000,'daily_bonus',now()::text);
 RETURN QUERY SELECT true,v_total+2000,p.chips,now()+interval '24 hours',p.daily_bonus_streak;
END $$;
REVOKE ALL ON FUNCTION private.midnight_daily_bonus() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.midnight_daily_bonus() TO authenticated;
CREATE FUNCTION public.claim_midnight_daily_bonus()
RETURNS TABLE(claimed boolean,new_balance bigint,available_balance bigint,next_claim_at timestamptz,streak integer)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM private.midnight_daily_bonus() $$;
REVOKE ALL ON FUNCTION public.claim_midnight_daily_bonus() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_midnight_daily_bonus() TO authenticated;

CREATE FUNCTION private.midnight_wallet_event(p_payload text,p_signature text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e jsonb; v_secret text; v_uid uuid; v_nonce uuid; v_amount bigint; v_balance bigint; v_prior bigint;
 v_op text; v_reason text; v_room text; v_role text; v_process text; v_stamp bigint;
BEGIN
 IF length(p_payload)>4096 THEN RAISE EXCEPTION 'Invalid wallet event'; END IF;
 SELECT secret INTO v_secret FROM private.midnight_wallet_key WHERE id=true;
 IF p_signature IS NULL OR p_signature<>encode(extensions.hmac(p_payload,v_secret,'sha256'),'hex') THEN RAISE EXCEPTION 'Invalid wallet signature'; END IF;
 e:=p_payload::jsonb; v_uid:=(e->>'uid')::uuid; v_nonce:=(e->>'nonce')::uuid;
 v_op:=e->>'op'; v_room:=e->>'room'; v_process:=e->>'process'; v_amount:=coalesce((e->>'amount')::bigint,0); v_stamp:=(e->>'issuedAt')::bigint;
 IF v_stamp IS NULL OR abs(extract(epoch FROM clock_timestamp())*1000-v_stamp)>300000 THEN RAISE EXCEPTION 'Wallet event expired'; END IF;
 SELECT chips INTO v_balance FROM public.profiles WHERE uid=v_uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Player wallet not found'; END IF;
 IF EXISTS(SELECT 1 FROM private.midnight_wallet_events WHERE nonce=v_nonce) THEN RETURN v_balance; END IF;
 v_role:=current_setting('request.jwt.claim.role',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 IF v_op='buyin' THEN
  IF v_amount<=0 OR v_balance<v_amount THEN RAISE EXCEPTION 'Insufficient virtual chips'; END IF;
  INSERT INTO private.midnight_table_wallets(uid,room_id,process_id,chips) VALUES(v_uid,v_room,v_process,v_amount);
  UPDATE public.profiles SET chips=chips-v_amount WHERE uid=v_uid RETURNING chips INTO v_balance;
  v_reason:='table_buyin'; v_amount:=-v_amount;
 ELSIF v_op='cashout' THEN
  IF v_amount<0 THEN RAISE EXCEPTION 'Invalid cashout'; END IF;
  DELETE FROM private.midnight_table_wallets WHERE uid=v_uid AND room_id=v_room AND process_id=v_process;
  IF NOT FOUND THEN RAISE EXCEPTION 'Table reservation not found'; END IF;
  UPDATE public.profiles SET chips=chips+v_amount WHERE uid=v_uid RETURNING chips INTO v_balance;
  v_reason:='table_cashout';
 ELSIF v_op='settle' THEN
  IF v_amount<0 OR (e->>'reason') NOT IN ('poker_hand','blackjack_hand') THEN RAISE EXCEPTION 'Invalid hand settlement'; END IF;
  SELECT chips INTO v_prior FROM private.midnight_table_wallets WHERE uid=v_uid AND room_id=v_room AND process_id=v_process FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Table reservation not found'; END IF;
  UPDATE private.midnight_table_wallets SET chips=v_amount WHERE uid=v_uid AND room_id=v_room;
  v_amount:=v_amount-v_prior; v_reason:=e->>'reason';
  UPDATE public.profiles SET lifetime_winnings=lifetime_winnings+greatest(v_amount,0) WHERE uid=v_uid;
 ELSIF v_op='recover' THEN
  SELECT coalesce(sum(chips),0)::bigint INTO v_amount FROM private.midnight_table_wallets WHERE uid=v_uid AND process_id<>v_process;
  DELETE FROM private.midnight_table_wallets WHERE uid=v_uid AND process_id<>v_process;
  UPDATE public.profiles SET chips=chips+v_amount WHERE uid=v_uid RETURNING chips INTO v_balance;
  v_reason:='table_recovery';
 ELSIF v_op='adjust' AND (e->>'reason') IN ('tournament_payout','welcome_bonus') THEN
  IF v_balance+v_amount<0 THEN RAISE EXCEPTION 'Insufficient virtual chips'; END IF;
  UPDATE public.profiles SET chips=chips+v_amount WHERE uid=v_uid RETURNING chips INTO v_balance;
  v_reason:=e->>'reason';
 ELSE RAISE EXCEPTION 'Invalid wallet operation'; END IF;
 PERFORM set_config('request.jwt.claim.role',coalesce(v_role,''),true);
 INSERT INTO private.midnight_wallet_events(nonce,uid) VALUES(v_nonce,v_uid);
 IF v_amount<>0 THEN INSERT INTO public.chip_ledger(uid,amount,balance_after,reason,game_id) VALUES(v_uid,v_amount,v_balance,v_reason,v_nonce::text); END IF;
 RETURN v_balance;
END $$;
REVOKE ALL ON FUNCTION private.midnight_wallet_event(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.midnight_wallet_event(text,text) TO anon,authenticated;
CREATE FUNCTION public.apply_midnight_wallet_event(p_payload text,p_signature text) RETURNS bigint
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.midnight_wallet_event(p_payload,p_signature) $$;
REVOKE ALL ON FUNCTION public.apply_midnight_wallet_event(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_midnight_wallet_event(text,text) TO anon,authenticated;
