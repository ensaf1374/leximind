-- LexiMind — run in the Supabase SQL editor. Safe to run again after an update: nothing is deleted.
create extension if not exists pgcrypto;

-- Profiles (one per auth user)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  native_language text default 'fa',
  level text default 'intermediate',
  xp int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles: public names" on public.profiles;
create policy "profiles: public names" on public.profiles for select using (true);
drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"   on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"   on public.profiles for update using (auth.uid() = id);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Per-user app state (decks, history, xp, badges) as one JSON document
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table public.user_data enable row level security;
drop policy if exists "user_data: own rows" on public.user_data;
create policy "user_data: own rows" on public.user_data for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Public deck library
create table if not exists public.public_decks (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text default '',
  level text default 'intermediate',
  tags text[] default '{}',
  cards jsonb not null,
  card_count int not null,
  downloads int default 0,
  likes int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.public_decks enable row level security;
drop policy if exists "public_decks: anyone reads" on public.public_decks;
create policy "public_decks: anyone reads"  on public.public_decks for select using (true);
drop policy if exists "public_decks: owner inserts" on public.public_decks;
create policy "public_decks: owner inserts" on public.public_decks for insert with check (auth.uid() = owner);
drop policy if exists "public_decks: owner updates" on public.public_decks;
create policy "public_decks: owner updates" on public.public_decks for update using (auth.uid() = owner);
drop policy if exists "public_decks: owner deletes" on public.public_decks;
create policy "public_decks: owner deletes" on public.public_decks for delete using (auth.uid() = owner);

create table if not exists public.deck_likes (
  deck_id uuid references public.public_decks(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  primary key (deck_id, user_id)
);
alter table public.deck_likes enable row level security;
drop policy if exists "deck_likes: read" on public.deck_likes;
create policy "deck_likes: read" on public.deck_likes for select using (true);
drop policy if exists "deck_likes: own" on public.deck_likes;
create policy "deck_likes: own"  on public.deck_likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Counters are maintained server-side so clients cannot inflate them.
-- A download is counted once per signed-in user per deck (guests can still copy decks; they are just not counted).
create table if not exists public.deck_downloads (
  deck_id uuid references public.public_decks(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  primary key (deck_id, user_id)
);
alter table public.deck_downloads enable row level security;  -- no policies: only the function below can touch it

create or replace function public.download_deck(p_deck uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.deck_downloads (deck_id, user_id) values (p_deck, auth.uid()) on conflict do nothing;
  if found then update public.public_decks set downloads = downloads + 1 where id = p_deck; end if;
end $$;
create or replace function public.toggle_like(p_deck uuid) returns boolean language plpgsql security definer set search_path = public as $$
declare liked boolean;
begin
  if auth.uid() is null then raise exception 'Sign in to like decks'; end if;
  if exists (select 1 from public.deck_likes where deck_id = p_deck and user_id = auth.uid()) then
    delete from public.deck_likes where deck_id = p_deck and user_id = auth.uid();
    update public.public_decks set likes = greatest(likes - 1, 0) where id = p_deck;
    liked := false;
  else
    insert into public.deck_likes (deck_id, user_id) values (p_deck, auth.uid());
    update public.public_decks set likes = likes + 1 where id = p_deck;
    liked := true;
  end if;
  return liked;
end $$;

-- AI usage quota (written by the claude-proxy Edge Function with the service role)
create table if not exists public.api_usage (
  user_id uuid references auth.users(id) on delete cascade,
  day date not null default current_date,
  calls int not null default 0,
  tokens int not null default 0,
  primary key (user_id, day)
);
alter table public.api_usage enable row level security;
drop policy if exists "api_usage: read own" on public.api_usage;
create policy "api_usage: read own" on public.api_usage for select using (auth.uid() = user_id);

create or replace function public.bump_api_usage(p_user uuid, p_tokens int) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.api_usage (user_id, day, calls, tokens) values (p_user, current_date, 1, p_tokens)
  on conflict (user_id, day) do update set calls = api_usage.calls + 1, tokens = api_usage.tokens + p_tokens
  returning calls into n;
  return n;
end $$;
-- Only the Edge Function (service role) may count usage. Without this, any visitor could call the function
-- with someone else's user id and use up that person's daily AI limit.
revoke execute on function public.bump_api_usage(uuid, int) from public, anon, authenticated;
grant execute on function public.bump_api_usage(uuid, int) to service_role;

-- Leaderboard: top 50 by XP (names/avatars are already public)
create or replace view public.leaderboard as
  select id, display_name, avatar_url, xp from public.profiles where xp > 0 order by xp desc limit 50;
