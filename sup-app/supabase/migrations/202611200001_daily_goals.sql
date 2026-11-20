-- Daily goals the user picked from the app's hardcoded bank (src/lib/goals/goalBank.ts).
-- One row per picked goal per local day; completed_at is set when the app finds
-- the goal done. goal_id is the goal's rule (src/lib/goals/goalRules.ts).
-- goal_text is copied in so history survives later edits to the bank.
create table public.daily_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_date date not null check (goal_date >= date '2020-01-01'),
  goal_set text not null check (goal_set in ('hardware', 'no_hardware')),
  section text not null check (section in ('posture', 'exercise', 'sitting')),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  goal_id text not null check (length(goal_id) between 1 and 64),
  goal_text text not null check (length(goal_text) between 1 and 200),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, goal_date, goal_id)
);
create index daily_goals_completed_idx on public.daily_goals (user_id, goal_date desc, completed_at desc)
  where completed_at is not null;
alter table public.daily_goals enable row level security;
revoke all on public.daily_goals from anon;
grant select, insert, update, delete on public.daily_goals to authenticated;
create policy "Read own goals" on public.daily_goals for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own goals" on public.daily_goals for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Edit own goals" on public.daily_goals for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own goals" on public.daily_goals for delete to authenticated using ((select auth.uid()) = user_id);
