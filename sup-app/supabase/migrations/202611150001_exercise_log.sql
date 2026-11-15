-- Manual workouts only. One row atomically saves a session and all its exercises.
create function public.valid_exercise_entries(entries jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare exercise jsonb; amount jsonb;
begin
  if jsonb_typeof(entries) is distinct from 'array' then return false; end if;
  if jsonb_array_length(entries) not between 1 and 30 then return false; end if;
  for exercise in select value from jsonb_array_elements(entries) loop
    if jsonb_typeof(exercise) is distinct from 'object'
       or jsonb_typeof(exercise->'name') is distinct from 'string'
       or length(trim(exercise->>'name')) not between 1 and 80
       or coalesce(exercise->>'category', '') not in ('strength', 'other')
       or coalesce(exercise->>'unit', '') not in ('reps', 'seconds', 'minutes')
       or jsonb_typeof(exercise->'values') is distinct from 'array' then return false; end if;
    if (exercise->>'category' = 'strength' and exercise->>'unit' = 'minutes')
       or (exercise->>'category' = 'other' and exercise->>'unit' <> 'minutes') then return false; end if;
    if jsonb_array_length(exercise->'values') not between 1 and 50
       or (exercise->>'unit' = 'minutes' and jsonb_array_length(exercise->'values') <> 1) then return false; end if;
    for amount in select value from jsonb_array_elements(exercise->'values') loop
      if jsonb_typeof(amount) is distinct from 'number' then return false; end if;
      if amount::text::numeric <= 0 or amount::text::numeric > 10000 then return false; end if;
      if exercise->>'unit' <> 'minutes' and trunc(amount::text::numeric) <> amount::text::numeric then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

create table public.exercise_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  performed_on date not null check (performed_on >= date '1900-01-01'),
  back_feeling smallint not null check (back_feeling between 1 and 5),
  exercises jsonb not null check (public.valid_exercise_entries(exercises)),
  created_at timestamptz not null default now()
);
create index exercise_workouts_user_date_idx on public.exercise_workouts (user_id, performed_on desc, created_at desc);
alter table public.exercise_workouts enable row level security;
revoke all on public.exercise_workouts from anon;
grant select, insert, update, delete on public.exercise_workouts to authenticated;
create policy "Read own workouts" on public.exercise_workouts for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own workouts" on public.exercise_workouts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Edit own workouts" on public.exercise_workouts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own workouts" on public.exercise_workouts for delete to authenticated using ((select auth.uid()) = user_id);
