-- Paint Clash : comptes, pseudos uniques (#), amis
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  sub_hash text unique not null,
  name text not null,
  tag text not null,
  name_changed_at timestamptz not null default to_timestamp(0),
  hero text not null default 'cubo',
  stars int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_name_tag on public.profiles (lower(name), tag);

create table if not exists public.friends (
  a uuid not null references public.profiles(id) on delete cascade,
  b uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a <> b)
);
create index if not exists friends_b on public.friends (b);

-- Personne ne lit ni n'écrit ces tables directement depuis le jeu :
-- tout passe par le serveur Vercel (clé secrète), après vérification du compte Google.
alter table public.profiles enable row level security;
alter table public.friends enable row level security;
