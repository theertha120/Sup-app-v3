# Leaderboard loading

Community requests five daily entries plus the signed-in user's rank. The full
leaderboard requests 50 entries initially and appends pages as the user scrolls.
Everyone/friends and day/week each have their own cache, shared by both screens.
Nothing is fetched for the leaderboard at sign-in. Requests already in progress
are shared, and failed refreshes keep the last successful entries visible.

## Database change

Apply `supabase/migrations/202610250001_leaderboard_pages.sql` through the project's
normal Supabase migration workflow to enable the main performance improvement.
It adds `get_leaderboard_page` and indexes for daily scores and accepted friends.
The function calculates means, competition ranks, total count and the viewer's
own entry in one database statement. Only the requested page is transferred.
Only authenticated users can call it; it runs with the caller's permissions and
preserves the tables' existing row-level security policies.

The migration is additive. It does not alter existing rows or scoring rules.
As before, weekly means count recorded daily rows (including a null score as
zero), ties share ranks, and users without recorded data receive zero.

The repository has no complete database schema or local database runtime. Check
this migration against staging's schema and access policies before production
rollout, including visibility of other users' scores under existing RLS.

## Compatibility before migration

If the ranking function is absent, the app falls back to fully paginated profile,
score and friend queries in parallel. It fetches only compact score columns,
never state totals or session details, and caches computed rankings. Pagination
continues until an empty response, including when the server caps responses below
the requested size. A failed page fails the whole snapshot rather than displaying
incomplete ranks. Permission and network failures do not trigger a fallback.

This compatibility path still downloads the visible roster and scores, so the
server-side transfer savings require the migration. The function is checked again
after a minute, allowing an existing app session to adopt it after rollout.

## Checks

Run `node --test tests/leaderboard.test.mjs` from `sup-app/` for pagination,
ranking, concurrent requests, cache and failure regression tests. Run
`node --test tests/*.test.mjs` for the complete local suite.

Validate scroll performance and server query timing on a device against staging;
local tests use injected database responses and do not execute the SQL migration.
