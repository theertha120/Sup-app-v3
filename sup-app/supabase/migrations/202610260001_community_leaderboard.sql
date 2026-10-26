-- Uses main's time-weighted state credits and one 10-minute prior per period.
-- Caller permissions and existing table RLS remain in effect.
create index if not exists community_daily_date_user_idx on public.posture_daily (date, user_id);
create index if not exists community_friends_from_idx on public.friend_requests (from_user_id, to_user_id) where status = 'accepted';
create index if not exists community_friends_to_idx on public.friend_requests (to_user_id, from_user_id) where status = 'accepted';

create or replace function public.community_leaderboard_page(
  p_start date, p_end date, p_scope text default 'everyone', p_offset integer default 0, p_limit integer default 50
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_start > p_end or p_start < p_end - 6
    or p_scope is null or p_scope not in ('everyone', 'friends')
    or p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Invalid leaderboard request' using errcode = '22023';
  end if;
  with friends as materialized (
    select distinct case when f.from_user_id = auth.uid() then f.to_user_id else f.from_user_id end as id
    from public.friend_requests f where f.status = 'accepted' and (f.from_user_id = auth.uid() or f.to_user_id = auth.uid())
  ), roster as materialized (
    select p.id, p.name, p.username, p.avatar_url,
      coalesce(nullif(trim(p.username), ''), trim(p.name), '') as display_name
    from public.profiles p where p_scope = 'everyone' or p.id = auth.uid() or exists (select 1 from friends f where f.id = p.id)
  ), totals as (
    select d.user_id, count(*) as days_counted, sum(parts.tracked_ms) as tracked_ms, sum(parts.credit_ms) as credit_ms
    from public.posture_daily d join roster r on r.id = d.user_id
    cross join lateral (
      select sum(coalesce((d.state_totals ->> c.state)::numeric, 0)) as tracked_ms,
        sum(coalesce((d.state_totals ->> c.state)::numeric, 0) * c.credit) as credit_ms
      from (values ('upright', 100), ('transition', 75), ('forward_lean', 50),
        ('tilted_left', 50), ('tilted_right', 50), ('slouched', 25), ('severe', 0)) c(state, credit)
    ) parts
    where d.date between p_start and p_end group by d.user_id
  ), scores as (
    select r.*, coalesce(t.days_counted, 0) as days_counted,
      case when t.tracked_ms > 0 then round((t.credit_ms + 50::numeric * 600000) / (t.tracked_ms + 600000), 1) else 0 end as score
    from roster r left join totals t on t.user_id = r.id
  ), ranked as materialized (
    select s.*, rank() over (order by score desc) as rank from scores s
  ), page as (
    select * from ranked order by score desc, display_name, id offset p_offset limit p_limit
  )
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(to_jsonb(p) - 'display_name' order by p.score desc, p.display_name, p.id) from page p), '[]'::jsonb),
    'own', (select to_jsonb(r) - 'display_name' from ranked r where r.id = auth.uid()),
    'total', (select count(*) from ranked),
    'friends', (select count(*) from friends where id <> auth.uid())
  ) into result;
  return result;
end;
$$;
revoke all on function public.community_leaderboard_page(date, date, text, integer, integer) from public, anon;
grant execute on function public.community_leaderboard_page(date, date, text, integer, integer) to authenticated;
