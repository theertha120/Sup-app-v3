-- Posture/sensor tracking tables.
-- One row per desk session (posture_sessions), per posture-state transition
-- (posture_state_events), per intervention nudge (posture_interventions), and
-- one rolled-up row per user per day (posture_daily).
--
-- All tables are keyed by user_id (text, matches public.profiles.id / auth.uid()).
--
-- NOTE: public.posture_daily already existed in this project (minutes-based
-- shape: good_posture_minutes/bad_posture_minutes/total_minutes/avg_score,
-- unique (user_id, date), FK to profiles on delete cascade) — it's extended
-- here with a richer state_totals breakdown rather than recreated. Everything
-- below is written to be safely re-runnable.

create table if not exists public.posture_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  avg_shs numeric,
  min_shs numeric,
  max_cpl numeric,
  avg_instant_score numeric,
  total_duration_ms bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists posture_sessions_user_id_started_at_idx
  on public.posture_sessions (user_id, started_at desc);

create index if not exists posture_sessions_open_idx
  on public.posture_sessions (user_id, started_at)
  where ended_at is null;

create table if not exists public.posture_state_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.posture_sessions(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  state text not null,
  severity text not null,
  entered_at timestamptz not null,
  exited_at timestamptz not null,
  duration_ms integer not null,
  avg_pitch_diff numeric,
  avg_roll_diff numeric
);

create index if not exists posture_state_events_session_id_idx
  on public.posture_state_events (session_id);

create index if not exists posture_state_events_user_id_entered_at_idx
  on public.posture_state_events (user_id, entered_at desc);

create table if not exists public.posture_interventions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.posture_sessions(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  state text not null,
  fired_at timestamptz not null,
  cpl_at_alert numeric,
  dismissed_at timestamptz,
  user_moved boolean
);

create index if not exists posture_interventions_session_id_idx
  on public.posture_interventions (session_id);

create index if not exists posture_interventions_user_id_fired_at_idx
  on public.posture_interventions (user_id, fired_at desc);

-- posture_daily already exists — extend it rather than create it.
alter table public.posture_daily
  add column if not exists state_totals jsonb not null default '{}',
  add column if not exists total_desk_ms bigint not null default 0,
  add column if not exists session_count integer not null default 0,
  add column if not exists intervention_count integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

-- ── Row Level Security ────────────────────────────────────────────────────
-- Users may only read/write their own rows. No delete policy — rows are
-- retained; app never issues deletes. drop-if-exists first so this block is
-- safely re-runnable.

alter table public.posture_sessions enable row level security;
alter table public.posture_state_events enable row level security;
alter table public.posture_interventions enable row level security;
alter table public.posture_daily enable row level security;

drop policy if exists "posture_sessions_select_own" on public.posture_sessions;
drop policy if exists "posture_sessions_insert_own" on public.posture_sessions;
drop policy if exists "posture_sessions_update_own" on public.posture_sessions;
create policy "posture_sessions_select_own" on public.posture_sessions
  for select using (user_id = auth.uid()::text);
create policy "posture_sessions_insert_own" on public.posture_sessions
  for insert with check (user_id = auth.uid()::text);
create policy "posture_sessions_update_own" on public.posture_sessions
  for update using (user_id = auth.uid()::text);

drop policy if exists "posture_state_events_select_own" on public.posture_state_events;
drop policy if exists "posture_state_events_insert_own" on public.posture_state_events;
create policy "posture_state_events_select_own" on public.posture_state_events
  for select using (user_id = auth.uid()::text);
create policy "posture_state_events_insert_own" on public.posture_state_events
  for insert with check (user_id = auth.uid()::text);

drop policy if exists "posture_interventions_select_own" on public.posture_interventions;
drop policy if exists "posture_interventions_insert_own" on public.posture_interventions;
drop policy if exists "posture_interventions_update_own" on public.posture_interventions;
create policy "posture_interventions_select_own" on public.posture_interventions
  for select using (user_id = auth.uid()::text);
create policy "posture_interventions_insert_own" on public.posture_interventions
  for insert with check (user_id = auth.uid()::text);
create policy "posture_interventions_update_own" on public.posture_interventions
  for update using (user_id = auth.uid()::text);

drop policy if exists "posture_daily_select_own" on public.posture_daily;
drop policy if exists "posture_daily_insert_own" on public.posture_daily;
drop policy if exists "posture_daily_update_own" on public.posture_daily;
create policy "posture_daily_select_own" on public.posture_daily
  for select using (user_id = auth.uid()::text);
create policy "posture_daily_insert_own" on public.posture_daily
  for insert with check (user_id = auth.uid()::text);
create policy "posture_daily_update_own" on public.posture_daily
  for update using (user_id = auth.uid()::text);
