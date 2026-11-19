# XP and levels

**XP replaces the s'up s'core.** Wherever the app showed the daily or period s'core, it now shows XP:
- the Daily tab;
- Stats;
- the leaderboard;
- the Desk session summary;
- the profile dropdown and modal (as the level);
- the AI coach's daily insight.

XP rewards doing the habit: tracking, checking in, exercising and, later, finishing goals. It's earned per phone-local day, added up over every day, and never goes down. The total sets your level.

The old s'up s'core formula is still in `postureSyncService.ts` (`computeSupScore`, `supScoreForRows`) and still unit-tested. Every place that used it is commented out and marked `[s'up s'core — RETIRED]`, so the change can be rolled back. `posture_daily.sup_score` keeps its old values but is no longer written.

## How XP is earned (per day)

| Action | XP | Rule |
|---|---|---|
| Posture check-in | 10 | Once a day, if at least one check-in was logged that day |
| Exercise log | 10 | Once a day, if at least one manual workout is logged for that day |
| s'it / s'quat / s'tep sessions | 5 per full 10 min | All session time that day added together, rounded down to full 10-minute blocks, max **150 a day** (= 5 hours) |
| Daily goal completed | 10 / 20 / 40 | Easy / medium / hard, for each goal completed |

Example day: 2 check-ins, 1 workout, 45 min of s'it, 1 medium goal → 10 + 10 + 20 (4 blocks × 5) + 20 = **60 XP**. Most in one day without goals: 170.

## Levels

The first two steps are 100 and 200; after that, each step is the two before it added together:

| Level | XP for this level | Total XP to reach it |
|---|---|---|
| 0 | — | 0 |
| 1 | 100 | 100 |
| 2 | 200 | 300 |
| 3 | 300 | 600 |
| 4 | 500 | 1,100 |
| 5 | 800 | 1,900 |
| 6 | 1,300 | 3,200 |
| 7 | 2,100 | 5,300 |

400 XP is level 2. The progress text is `Level 3 - 21/500`: level 3, 21 XP into the 500 needed for level 4 (621 in total). Below 100 it reads `Level 0 - 50/100`.

## Where XP is stored

SQL: `supabase/migrations/202611190001_xp.sql`. Run it in the Supabase SQL editor before using a build with this change.

| Table | New column | Meaning |
|---|---|---|
| `posture_daily` | `xp integer not null default 0` | XP earned that day |
| `posture_daily` | `xp_breakdown jsonb` | `{ postureCheckin, exerciseLog, sessions, goals }` |
| `profiles` | `xp_total integer not null default 0` | Lifetime XP (sum of `posture_daily.xp`) |
| `profiles` | `xp_level integer not null default 0` | Level for `xp_total` |

The same SQL also replaces `community_leaderboard_page`. It keeps the same name, arguments and JSON shape, but `score` is now the **XP earned in the period** (day or week), ranked highest first. `days_counted` is now the number of days that earned XP. The app's fallback ranking (used if the function is missing) does the same.

**Days with only a check-in or workout** now get a `posture_daily` row, with zeros in the posture columns, so their XP counts on the leaderboard. The app never overwrites an existing row's posture data when saving XP; it only updates the XP columns.

## Where the numbers come from

| Source | Read from | Day used |
|---|---|---|
| s'it session time | `posture_daily.total_desk_ms` (completed sessions) | `date` (day the session started) |
| Posture check-ins | `posture_checkins.logged_at` | Phone-local day |
| Exercise | `exercise_workouts.performed_on` | `performed_on` |

## When XP is saved (the app writes it)

The app calculates and saves XP, the same way it already saves `posture_daily`. Code: `src/services/xp/xpService.ts`, rules in `src/services/xp/xpRules.ts`.

| Event | What runs |
|---|---|
| A session ends | `IMUContext` rebuilds the day 5 s later, then `syncDayXp(user, that day)` |
| A posture check-in is saved | `syncDayXp(user, today)` from the check-in screen |
| A workout is saved, edited or deleted | `syncDayXp` for its date (both dates if an edit moved it) from the Exercise page |
| Sign-in / app start | `XpSync` runs `syncAllXp(user)` once: recalculates every day, writes only days whose stored XP is wrong (including back to 0), and sets `profiles.xp_total` / `xp_level`. This backfills history from before XP and repairs writes that failed offline |

Each `syncDayXp` also re-adds every day's stored XP and saves the profile total and level. A sync only writes what actually differs: a day whose XP didn't change isn't rewritten, and the profile isn't updated if its total and level are already right. Syncs run one at a time, and failures go to Sentry (`xp-sync-day`, `xp-sync-all`) without breaking the app.

### Screens update when XP changes

When a sync changes a day's XP or the profile total, it calls `subscribeToXpChanges` listeners (`xpService.ts`). Syncs that change nothing stay silent. Listening:

| Listener | What it does |
|---|---|
| `PostureHistoryContext` (Stats) | Reloads the posture history, so Stats shows the new XP without tapping refresh. If a load is already running (e.g. the sign-in backfill finishing during the first load), it runs one more load afterwards instead of dropping the request |
| `HeaderBar` (profile dropdown) | Refetches the level text |
| `ProfileModal` (while open) | Refetches that user's level |
| `LeaderboardContext` | Invalidates the cache: refetches the views on screen and marks the others stale |

The Daily tab already refetches its day every time it's focused, so it picks up new XP when you come back to it.

## What each screen shows now

| Screen | Before | Now |
|---|---|---|
| Daily tab "s'core" | Day's s'core (0–100) | XP earned today (adds up through the day); the change badge compares with yesterday's XP |
| Stats bars | Each day's s'core | Each day's XP |
| Stats week/month/year total | Time-weighted s'core | XP added up over the period |
| Leaderboard | Period s'core | XP earned in the period |
| Desk session summary | Session s'core | XP this session earned (5 per full 10 min) |
| Profile dropdown and modal | Average weekly points | `Level 3 - 21/500` (from `profiles.xp_total`) |
| AI coach (s'kipper) | s'core per day, best/worst day by s'core | XP per day, most/least XP day. "Days tracked" and the trend count only days with session time. Posture quality still comes from the posture breakdown |

### On-screen text and colours

Layouts are unchanged; only the wording, units and colours moved to XP. Old text is kept as `[s'up s'core — RETIRED]` comments next to each change.

| Where | Now says |
|---|---|
| Daily tab | "xp" label, "N xp" value. The intro says "the xp you've earned today"; the info popup explains how XP is earned |
| Daily tab, s'ession info | Every full 10 minutes earns 5 xp, up to 150 a day |
| Stats | Card is "xp trend". Header is "total N xp" with "↑/↓ N xp"; bar popups are in "xp" with "daily/weekly/monthly total". Info text explains XP |
| Stats bar colours | No good/bad bands (XP is effort, not quality): the tapped bar is darker green |
| Desk session summary | "xp earned", green when above 0 (grey for 0); the info popup explains session XP |
| Leaderboard | "see how your xp stacks up against the community!"; full leaderboard rows show "N xp" |
| Profile dropdown and modal | "xp" / "XP" with "Level 3 - 21/500" |
| Home daily insight info | "…plus your daily xp and total tracked time" |
| Settings → Sources & Methodology | Description is "How s'train and your xp are calculated…". The s'core formula section is replaced by "how xp and levels work"; the old section stays as a commented-out block |

The level in the profile dropdown and modal, Stats and the leaderboard update by themselves when XP changes (see "Screens update when XP changes").

## Adding s'quat, s'tep and daily goals later

The rules already score these. Add their data in `buildDailyActivity` and `dayActivity` (`xpService.ts`):
- **s'quat / s'tep:** each day's tracked time goes into `sessionMs.squat` / `sessionMs.step`, sharing the 150-a-day cap with s'it.
- **Goals:** push `'easy' | 'medium' | 'hard'` into `goalsCompleted` for the day.

Then call `syncDayXp` when one is recorded.

## Things to know / decide

- **Level 2 threshold:** the spec says both "250 for level 2" and "Level 2: 200 (300)". This uses the table: 300 total.
- **Level 0:** below 100 XP is level 0. Starting everyone at level 1 is a one-line change in `levelFor`.
- **Backdated workouts:** a workout logged for an earlier date earns XP on that date, which on a ranked board means someone could backfill last week.
- **Trust:** XP is written by the app, like the rest of `posture_daily`, so a modified app could fake it. Moving the calculation into Supabase triggers would prevent that.
- **Stale sessions:** a session that was never ended is recovered when the next session starts. Its XP is added at the next sign-in sync.
