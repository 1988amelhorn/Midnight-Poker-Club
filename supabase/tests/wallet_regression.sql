-- All account changes in this regression test are rolled back.
BEGIN;
DO $$
DECLARE u uuid; r record; n uuid; payload text; sig text; secret text; total bigint;
BEGIN
 SELECT uid INTO u FROM public.profiles ORDER BY created_at LIMIT 1;
 IF u IS NULL THEN RAISE EXCEPTION 'An existing test fixture is required'; END IF;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 UPDATE public.profiles SET chips=10000,last_reload_at=null,daily_bonus_streak=0 WHERE uid=u;
 DELETE FROM private.midnight_table_wallets WHERE uid=u;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 SELECT * INTO r FROM public.claim_midnight_daily_bonus();
 IF NOT r.claimed OR r.new_balance<>12000 OR r.available_balance<>12000 THEN RAISE EXCEPTION 'Bonus was not saved'; END IF;
 SELECT * INTO r FROM public.claim_midnight_daily_bonus();
 IF r.claimed OR r.new_balance<>12000 THEN RAISE EXCEPTION 'Bonus claimed twice'; END IF;
 BEGIN
  UPDATE public.profiles SET last_reload_at=null WHERE uid=u;
  RAISE EXCEPTION 'Cooldown guard missing';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='Cooldown guard missing' THEN RAISE; END IF; END;
 SELECT k.secret INTO secret FROM private.midnight_wallet_key k WHERE id=true;
 FOR r IN SELECT * FROM (VALUES ('buyin',1000::bigint,null::text,12000::bigint),('settle',1250::bigint,'poker_hand',12250::bigint),('settle',1400::bigint,'blackjack_hand',12400::bigint),('cashout',1400::bigint,null::text,12400::bigint)) AS v(op,amount,reason,expected) LOOP
  n:=gen_random_uuid();
  payload:=jsonb_build_object('uid',u,'op',r.op,'amount',r.amount,'reason',r.reason,'room','wallet-regression','process','wallet-test','nonce',n,'issuedAt',floor(extract(epoch FROM clock_timestamp())*1000))::text;
  sig:=encode(extensions.hmac(payload,secret,'sha256'),'hex');
  PERFORM public.apply_midnight_wallet_event(payload,sig);
  -- Re-delivery after a lost HTTP response must never award chips twice.
  PERFORM public.apply_midnight_wallet_event(payload,sig);
  SELECT chip_balance INTO total FROM public.get_midnight_wallet();
  IF total<>r.expected THEN RAISE EXCEPTION 'Wallet total mismatch for %: %',r.op,total; END IF;
 END LOOP;
 BEGIN
  PERFORM public.apply_midnight_wallet_event(payload,repeat('0',64));
  RAISE EXCEPTION 'Unsigned payout accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='Unsigned payout accepted' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
