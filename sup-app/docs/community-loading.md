# Community loading

Community opens a daily view with five entries and the viewer's own rank.
The full leaderboard requests 50 entries per page. View caches are account-local
and shared between both screens. The leaderboard provider does not fetch at login.
Local avatar reads and profile updates are independent of ranking requests.

## Server query rollout

Apply `supabase/migrations/202610260001_community_leaderboard.sql` through the
project's normal Supabase migration workflow. It adds `community_leaderboard_page`
and supporting indexes. It does not modify saved scores or existing policies.
The function is SECURITY INVOKER, available only to authenticated callers, and
uses existing RLS on profiles, daily posture and friend requests.

The server sums tracked milliseconds and weighted posture credits over the
requested period. It adds the 10-minute prior at 50 once per period, matching
main's `supScoreForRows`, then rounds to one decimal before assigning competition
ranks. Users with no tracked time receive zero. Days counted remain daily rows,
matching the existing leaderboard's `sessionsCounted` field.

The function name deliberately differs from older experimental leaderboard
functions, which used a mean of daily scores. No old migration is required.

Before this migration is applied, only a missing-function response enables the
compatibility source. It fully paginates profiles, the period's state totals,
and accepted friend IDs in parallel, and calls main's existing ranking function.
It cannot reduce transfer to five/50 ranked rows without server aggregation.
Permission and network failures remain visible; they do not trigger extra scans.

The migration must be checked against the deployed schema and RLS in staging.
No remote database was changed by implementing these app changes. Local tests
inject responses and verify main's score calculation, but do not execute SQL.

## Verification

From `sup-app/`, run `node --test tests/leaderboard.test.mjs` or the full suite
with `node --test tests/*.test.mjs`. Device checks should include a cold open,
rapid tab changes, slow/offline requests, friends changes, and long lists.
