-- Bibi Planner schema (Supabase)
-- Run in Supabase SQL Editor

create extension if not exists "pgcrypto";

-- Tables
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  schedule_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, schedule_date)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  title text not null,
  minutes integer not null,
  start_minute integer not null,
  color text not null,
  preset_type text,
  notify boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  inviter_id uuid not null,
  invitee_id uuid not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create table if not exists public.profiles (
  user_id uuid primary key,
  discord_id text unique,
  discord_username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Updated-at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists set_schedules_updated_at on public.schedules;
create trigger set_schedules_updated_at
before update on public.schedules
for each row execute procedure public.set_updated_at();

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row execute procedure public.set_updated_at();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

-- RLS
alter table public.schedules enable row level security;
alter table public.tasks enable row level security;
alter table public.invites enable row level security;
alter table public.profiles enable row level security;

-- Drop existing policies (clean run)
drop policy if exists schedules_select_own on public.schedules;
drop policy if exists schedules_modify_own on public.schedules;
drop policy if exists tasks_select_own on public.tasks;
drop policy if exists tasks_modify_own on public.tasks;
drop policy if exists invites_select_own on public.invites;
drop policy if exists invites_modify_own on public.invites;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_modify_own on public.profiles;

-- Policies
create policy schedules_select_own
  on public.schedules for select
  using (auth.uid() = user_id);

create policy schedules_modify_own
  on public.schedules for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy tasks_select_own
  on public.tasks for select
  using (exists (
    select 1 from public.schedules s where s.id = tasks.schedule_id and s.user_id = auth.uid()
  ));

create policy tasks_modify_own
  on public.tasks for all
  using (exists (
    select 1 from public.schedules s where s.id = tasks.schedule_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.schedules s where s.id = tasks.schedule_id and s.user_id = auth.uid()
  ));

create policy invites_select_own
  on public.invites for select
  using (auth.uid() = inviter_id or auth.uid() = invitee_id);

create policy invites_modify_own
  on public.invites for all
  using (auth.uid() = inviter_id or auth.uid() = invitee_id)
  with check (auth.uid() = inviter_id or auth.uid() = invitee_id);

create policy profiles_select_own
  on public.profiles for select
  using (auth.uid() = user_id);

create policy profiles_modify_own
  on public.profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
