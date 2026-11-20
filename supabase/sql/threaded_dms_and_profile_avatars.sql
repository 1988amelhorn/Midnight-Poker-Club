-- Direct messages and avatar photos. Applied only to Midnight Poker Club's live legacy schema.
-- Messages are visible only to the sender and recipient.
create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_uid uuid not null references public.profiles(uid) on delete cascade,
  recipient_uid uuid not null references public.profiles(uid) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint direct_message_not_self check (sender_uid <> recipient_uid)
);
create index if not exists dm_sender_recent_idx on public.direct_messages(sender_uid, created_at desc);
create index if not exists dm_recipient_recent_idx on public.direct_messages(recipient_uid, created_at desc);
alter table public.direct_messages enable row level security;
revoke all on table public.direct_messages from public, anon;
grant select, insert on table public.direct_messages to authenticated;

drop policy if exists dm_select_participant on public.direct_messages;
create policy dm_select_participant on public.direct_messages
for select to authenticated
using (sender_uid = (select auth.uid()) or recipient_uid = (select auth.uid()));

drop policy if exists dm_insert_friend on public.direct_messages;
create policy dm_insert_friend on public.direct_messages
for insert to authenticated
with check (
  sender_uid = (select auth.uid())
  and recipient_uid <> (select auth.uid())
  and exists (
    select 1 from public.friends f
    where f.uid = (select auth.uid()) and f.friend_uid = recipient_uid
  )
);

-- Public profile photographs, with uploads restricted to each player's own folder.
-- Uploads are capped at 2 MB and the client only uploads resized WebP.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('player-avatars','player-avatars',true,2097152,array['image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/webp'];

drop policy if exists "player_avatar_upload_own" on storage.objects;
create policy "player_avatar_upload_own" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'player-avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and name ~ '^[0-9a-f-]{36}/avatar-[0-9a-f-]{36}\.webp$'
);
