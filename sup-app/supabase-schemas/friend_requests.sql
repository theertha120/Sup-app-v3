-- friend_requests.sql
-- Table to store friend requests between users

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id text not null references public.profiles(id) on delete cascade,
  to_user_id text not null references public.profiles(id) on delete cascade,
  status text not null default 'pending', -- pending|accepted|rejected|cancelled
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (from_user_id, to_user_id)
);

-- Indexes for common queries
create index if not exists idx_friend_requests_to_user on public.friend_requests (to_user_id);
create index if not exists idx_friend_requests_from_user on public.friend_requests (from_user_id);
create index if not exists idx_friend_requests_status on public.friend_requests (status);

-- Optional: materialized view or helper for active friend relationships
-- You can also create a view to list accepted friendships in both directions if desired.
