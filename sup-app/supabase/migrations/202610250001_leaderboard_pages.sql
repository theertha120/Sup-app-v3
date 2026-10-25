-- Additive migration: ranking stays under the caller's existing RLS policies.
create index if not exists leaderboard_daily_date_user_idx
  on public.posture_daily (date, user_id) include (sup_score);
create index if not exists leaderboard_friends_from_idx
  on public.friend_requests (from_user_id, to_user_id) where status = 'accepted';
create index if not exists leaderboard_friends_to_idx
  on public.friend_requests (to_user_id, from_user_id) where status = 'accepted';

create or replace function public.get_leaderboard_page(
  p_start_date date,
  p_end_date date,
  p_scope text default 'everyone',
  p_offset integer default 0,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date
     or p_start_date < p_end_date - 6
     or p_scope is null or p_scope not in ('everyone', 'friends')
     or p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Invalid leaderboard window or pagination' using errcode = '22023';
  end if;

  with friends as materialized (
    select distinct case when f.from_user_id = auth.uid() then f.to_user_id else f.from_user_id end as id
    from public.friend_requests f
    where f.status = 'accepted' and (f.from_user_id = auth.uid() or f.to_user_id = auth.uid())
  ), roster as (
    select p.id, p.name, p.username, p.avatar_url,
      coalesce(nullif(trim(p.username), ''), trim(p.name), '') as display_name
    from public.profiles p
    where p_scope = 'everyone' or p.id = auth.uid() or exists (select 1 from friends f where f.id = p.id)
  ), scores as (
    select d.user_id,
      round(sum(coalesce(d.sup_score, 0))::numeric / count(*), 1) as avg_sup_score,
      count(*) as sessions_counted
    from public.posture_daily d join roster r on r.id = d.user_id
    where d.date between p_start_date and p_end_date
    group by d.user_id
  ), ranked as materialized (
    select r.*, coalesce(s.avg_sup_score, 0) as avg_sup_score,
      coalesce(s.sessions_counted, 0) as sessions_counted,
      rank() over (order by coalesce(s.avg_sup_score, 0) desc) as rank
    from roster r left join scores s on s.user_id = r.id
  ), page as (
    select * from ranked
    order by avg_sup_score desc, display_name, id
    offset p_offset limit p_limit
  )
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(to_jsonb(p) - 'display_name' order by p.avg_sup_score desc, p.display_name, p.id) from page p), '[]'::jsonb),
    'own_entry', (select to_jsonb(r) - 'display_name' from ranked r where r.id = auth.uid()),
    'total', (select count(*) from ranked),
    'friend_count', (select count(*) from friends where id <> auth.uid())
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_leaderboard_page(date, date, text, integer, integer) from public, anon;
grant execute on function public.get_leaderboard_page(date, date, text, integer, integer) to authenticated;
