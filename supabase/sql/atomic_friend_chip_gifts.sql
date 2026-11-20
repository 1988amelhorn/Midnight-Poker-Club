-- Midnight Poker Club — persistent, atomic friend-chip gifts.
-- The existing live database stores virtual-chip balances in public.profiles.chips.
-- No client role receives direct UPDATE access to another player's chips.
create table if not exists public.friend_chip_gifts (
  id uuid primary key default gen_random_uuid(),
  sender_uid uuid not null references public.profiles(uid) on delete cascade,
  recipient_uid uuid not null references public.profiles(uid) on delete cascade,
  amount bigint not null check (amount between 1 and 10000),
  request_key text not null check (length(request_key) between 8 and 96),
  created_at timestamptz not null default now(),
  constraint friend_chip_gifts_no_self check (sender_uid <> recipient_uid),
  constraint friend_chip_gifts_one_request unique (sender_uid, request_key)
);

alter table public.friend_chip_gifts enable row level security;
revoke all on table public.friend_chip_gifts from public, anon, authenticated;

create or replace function public.transfer_virtual_chips(
  p_recipient uuid,
  p_amount bigint,
  p_key text
)
returns table(sender_balance bigint, recipient_balance bigint, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sender uuid := auth.uid();
  v_gift_id uuid;
  v_existing_recipient uuid;
  v_existing_amount bigint;
  v_sender_balance bigint;
  v_recipient_balance bigint;
  v_old_role text;
begin
  if v_sender is null then
    raise exception 'Authentication required';
  end if;
  if p_recipient is null or p_recipient = v_sender then
    raise exception 'Choose a valid friend to send chips to';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 10000 then
    raise exception 'Gift amount must be between 1 and 10,000 chips';
  end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,96}$' then
    raise exception 'Invalid gift request key';
  end if;
  if not exists (
    select 1 from public.friends f
    where f.uid = v_sender and f.friend_uid = p_recipient
  ) then
    raise exception 'You can only send chips to accepted friends';
  end if;

  -- Lock both accounts in a fixed order to avoid concurrent gift deadlocks.
  if v_sender < p_recipient then
    perform 1 from public.profiles where uid = v_sender for update;
    if not found then raise exception 'Sender wallet not found'; end if;
    perform 1 from public.profiles where uid = p_recipient for update;
    if not found then raise exception 'Recipient wallet not found'; end if;
  else
    perform 1 from public.profiles where uid = p_recipient for update;
    if not found then raise exception 'Recipient wallet not found'; end if;
    perform 1 from public.profiles where uid = v_sender for update;
    if not found then raise exception 'Sender wallet not found'; end if;
  end if;

  insert into public.friend_chip_gifts(sender_uid, recipient_uid, amount, request_key)
  values (v_sender, p_recipient, p_amount, p_key)
  on conflict (sender_uid, request_key) do nothing
  returning id into v_gift_id;

  if v_gift_id is null then
    select g.recipient_uid, g.amount into v_existing_recipient, v_existing_amount
    from public.friend_chip_gifts g
    where g.sender_uid = v_sender and g.request_key = p_key;
    if v_existing_recipient is distinct from p_recipient
      or v_existing_amount is distinct from p_amount then
      raise exception 'Gift request key has already been used for a different transfer';
    end if;
    select p.chips into v_sender_balance from public.profiles p where p.uid = v_sender;
    select p.chips into v_recipient_balance from public.profiles p where p.uid = p_recipient;
    return query select v_sender_balance, v_recipient_balance, true;
    return;
  end if;

  select p.chips into v_sender_balance
  from public.profiles p where p.uid = v_sender;
  if v_sender_balance < p_amount then
    raise exception 'Insufficient chips for this gift';
  end if;

  -- The existing wallet-guard trigger allows only controlled server operations
  -- to modify balances. Temporarily use its established service-role claim
  -- inside this narrowly scoped SECURITY DEFINER function, then restore it.
  v_old_role := current_setting('request.jwt.claim.role', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.profiles p set chips = p.chips - p_amount
    where p.uid = v_sender returning p.chips into v_sender_balance;
  update public.profiles p set chips = p.chips + p_amount
    where p.uid = p_recipient returning p.chips into v_recipient_balance;
  perform set_config('request.jwt.claim.role', coalesce(v_old_role, ''), true);

  insert into public.chip_ledger(uid, amount, balance_after, reason, game_id)
  values
    (v_sender, -p_amount, v_sender_balance, 'friend_gift_sent', v_gift_id::text),
    (p_recipient, p_amount, v_recipient_balance, 'friend_gift_received', v_gift_id::text);

  return query select v_sender_balance, v_recipient_balance, false;
end;
$function$;

-- SECURITY DEFINER routines are public by default in PostgreSQL. Restrict
-- this endpoint to signed-in players; sender identity comes only from auth.uid().
revoke all on function public.transfer_virtual_chips(uuid,bigint,text)
  from public, anon, service_role;
grant execute on function public.transfer_virtual_chips(uuid,bigint,text)
  to authenticated;
