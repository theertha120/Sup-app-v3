# Device test checklist

`npm test` covers the app's logic with everything outside it faked. This list
covers what it can't: real s'pots, the phone's OS, real Supabase, and deploys.
It's a living document: sections are organised by feature and updated whenever
a feature is added or changed (see [Maintaining this checklist](#maintaining-this-checklist)).

Run it on a **dev-client or release build** (not Expo Go) on Android, and on
iOS whenever a TestFlight build is available. A full pass takes about 30–40
minutes; for a small release, run the [release focus](#release-focus) items
plus any section whose feature was touched.

## Before you start

- [ ] `npm test` passes.
- [ ] Note the build, phone model, OS version and s'pot kit you're testing with.
- [ ] s'pots charged; a test account you can delete.
- [ ] Metro logs or `adb logcat` open (some checks read log lines).
- [ ] Any values set for testing are back to their production values (search the code for `FOR TESTING`).

## Release focus

Items specific to what's new in the upcoming release. Add them here while a
feature is in progress; when the release ships, move anything worth keeping
into its feature section below and clear this list.

- [ ] **Exercise Log release:** complete the Exercise Log section below on a dev-client/release build with the migration applied to the test database.
- [ ] **Navigation regression:** all six tabs open the right screen; Exercise is fourth, immediately after Stats; the selection highlight fits a narrow phone.
- [ ] Record actual device results in [exercise-log-test-results.md](exercise-log-test-results.md). Automated tests do not satisfy the manual items.

---

## Account

- [ ] **Sign up** with a new email → verification code arrives → enter it → onboarding continues to the final page.
- [ ] Enter a **wrong code** → readable error, can retry.
- [ ] Kill the app mid-onboarding after verifying, reopen → lands back in onboarding (not a broken home screen).
- [ ] **Sign out**, then **sign in** with the same account → home loads with your name and supsona.
- [ ] Sign in with a **wrong password** → clear error, app doesn't freeze.
- [ ] **Forgot password** → reset code arrives → set new password → can sign in with it.
- [ ] Edit **name / username / supsona** in the profile → shows on home and on the leaderboard after refresh.
- [ ] Try a username someone else has → "that username is taken".
- [ ] Open the app on consecutive days → **streak** goes up by 1; after a missed day it resets.

## Pairing and connecting

- [ ] Bluetooth **off** → connecting shows a clear "bluetooth isn't ready" state, no crash.
- [ ] Scan the **pairing QR** → both s'pots found by name → both connect.
- [ ] A s'pot with a **renamed** BLE name is still found (scanning doesn't depend on the name).
- [ ] Connect, kill the app, reopen → saved s'pots reconnect from the sensor screen.
- [ ] Both s'pots show **connected** and live readings within a few seconds.

## Calibration

- [ ] Run all **5 steps** (upright, forward, back, right, left) → summary shows your personal ranges.
- [ ] Sit upright after calibrating → **"good alignment"**. Slouch → "spine rounding". Lean sideways → "shifting left/right" on the correct side.
- [ ] Wear the kit **the other way round** (rotate both s'pots 180°), recalibrate → forward lean still reads as forward, not upright.
- [ ] On the forward step, **barely move** → app asks you to redo the step.
- [ ] Start a step with a s'pot **switched off** → step doesn't complete (no silent bad calibration).
- [ ] Kill and reopen the app → calibration is **remembered**.

## Live session (Desk mode)

- [ ] Session timer starts when both s'pots stream; figure, spine score and s'train respond as you change posture.
- [ ] Hold a **severe slouch ~5 min** → s'train pop-up appears once. Answer "moved" → s'train drops by about half. Next time answer "not now" → spine score drops ~5.
- [ ] Sit still in one position **15 min** → "time to move" nudge.
- [ ] Session runs **20+ min** without the app slowing down, heating up or the timer drifting.

## Screen locked / app in background

Android and iOS behave differently here, and so do phone makers' battery
settings. Do each on both platforms when you can and note what you saw.

- [ ] Start a session, **lock the screen 10 min**, unlock → session still running, same session (timer didn't reset).
- [ ] Same, but **switch to another app** for 10 min.
- [ ] While locked, hold a severe slouch until s'train fires → a **notification** appears; tapping it opens Desk mode.
- [ ] After a 10-min lock, end the session and check the session length on the summary. On Android, if the OS paused the app while the s'pots stayed connected, that time may be counted in the length. Note the result.
- [ ] Android: repeat with **battery saver on** → note whether the session survives.

## Disconnect and reconnect

- [ ] Mid-session, **switch off one s'pot** → "top/bottom s'pot disconnected" prompt (and a notification if the app is in the background).
- [ ] Tap **"reconnect s'pot"**, switch it back on → it reconnects within ~30s and the **same session** continues.
- [ ] Switch it off again → the prompt appears **again** (a second drop is still noticed).
- [ ] Switch one off and tap **"end s'ession"** → session saves; summary shows.
- [ ] Walk **out of range** with the phone, come back → same prompt behaviour.
- [ ] Connect both s'pots from setup, then drop one mid-session and reconnect it → no "operation was cancelled" errors in the logs.

## End of session, stats and daily score

- [ ] End a session → Desk shows the **summary** (replay with scrubber, highlights, comparison with the last session, s'kipper message).
- [ ] Kill and reopen → the latest summary still shows in Desk mode.
- [ ] Desk → under **recent history**, the session end summary and s'update history are separate cards, both collapsed by default (also after ending a new session); tapping each header expands/collapses it (the ⓘ on the summary still opens its info). While collapsed, the page scrolls normally.
- [ ] Wait ~10s after ending, open **Daily** → today's s'up s'core and minutes updated.
- [ ] **Stats week** → last bar is today; labels are the real weekdays.
- [ ] **Stats month** → wk 1–4, plus wk 5 only if the month has a 29th; tap a bar → correct date range.
- [ ] **Stats year** → each month's bar matches that month.
- [ ] On each stats card, dragging **right** shows older data (the older page slides in from the left), dragging left goes back to newer; past the newest/oldest page the card only rubber-bands. Vertical scrolling still works.
- [ ] A session that runs **past midnight** shows under the day it started.
- [ ] **Leaderboard** → your score appears; ranks look right.

## Exercise Log

Use a test account and test database with `202611150001_exercise_log.sql` applied. Test on Android and iOS when available. All boxes below are intentionally unchecked until a person observes the result on a device.

- [ ] **Page appearance:** open Exercise → the week card has space above it; no page title/subtitle or All/Strength/Other filter row. Fonts/colours match Sup. At larger text sizes and narrow widths, labels remain readable and the bottom bar does not cover history.
- [ ] **Swipe feel:** swipe left → older week; right → newer week; right at this week → resists and stays put. Short drags snap back. Fast flicks advance one week. Vertical scrolling and tapping a day still work. Only “swipe left for older data” appears as the hint.
- [ ] **Calendar:** open the calendar, move across a year boundary and select an older day → correct week and history. Future days cannot be selected. Logging an earlier workout stores the calendar date shown on the phone (also test shortly after local midnight).
- [ ] **Manual entry and keyboard:** log plank (3 × 30 sec), glute bridge (3 × 12 reps), and yoga (20 min), choose a back rating → correct card and success feedback. Numeric keyboard, scrolling and Save remain usable with the keyboard open.
- [ ] **Custom/varied sets:** log a custom strength exercise with different values per set, a long name, and another activity with fractional minutes → readable card and correct values after reopening.
- [ ] **Saved history:** relaunch → the saved workout persists. Refresh → no duplicate cards. In Supabase, one workout row contains every exercise and the correct owner, date and rating.
- [ ] **Reuse:** Use last values fills the matching exercise. Log again opens a draft dated today with no back rating, and creates no database row until Save is pressed.
- [ ] **Edit/delete:** edit a saved workout → updates the same database row after relaunch. Cancel deletion → row remains. Confirm deletion → row is removed and stays absent after relaunch.
- [ ] **Unsaved form:** change an amount, close → discard prompt. Keep editing retains the values. Discard closes without saving. Rapid Save taps create only one row.
- [ ] **Connection interruption:** interrupt the network during a save → no false success; record whether the app-wide offline screen appears and whether unsaved form values survive reconnection. Restore the network and retry → one saved workout. Do not mark this passed solely from the mocked failure test.
- [ ] **Account separation/RLS:** sign out and use a second test account → first account’s history is absent. Using authenticated test-user credentials, verify direct read/update/delete requests cannot access the other account’s workout. Dashboard administrator visibility does not prove RLS works.
- [ ] **Accessibility:** VoiceOver/TalkBack can identify each date, selected day, rating, Save, workout options and tab. Older/Newer week accessibility actions navigate the correct way; offscreen week pages are not read out.
- [ ] **Navigation while tracking:** with a real s’pot session active, open Exercise and save a manual workout → Desk tracking continues; Stats, Community and Daily still open normally. No squat/walk workout is automatically added by this feature.

## Reminders and notifications

- [ ] First launch → notification permission prompt. Deny → app still works.
- [ ] Inside your active hours, a **reminder** arrives at the expected interval.
- [ ] Reminder buttons **Yuh / Nuh / Ugh** each dismiss it; three "Ugh"s → the "We hear you!" message.
- [ ] Outside your active hours → no reminders.
- [ ] Leave the app → log shows `Re-engagement reminder scheduled for <~48h later, inside active hours>`. Reopen and leave again → a new time is logged (it replaces the old one).
- [ ] To see the re-engagement reminder fire without waiting 48h: in a dev build, temporarily shorten `RE_ENGAGEMENT_AFTER_MS` in `reminderEngineService.ts` (e.g. 2 minutes), leave the app and wait → notification arrives; tapping it adds a `reminder_log` row with `reminder_type = re_engagement`. **Revert afterwards.**
- [ ] Sign out and leave the app → no re-engagement reminder arrives for the old account.

## s'kipper (AI coach)

- [ ] During a session, a live s'kipper insight appears.
- [ ] At the end of a session, the s'kipper message appears in the summary.
- [ ] Home shows today's daily insight (or yesterday's if today's isn't generated yet).

## Offline

- [ ] **Airplane mode** during a session (s'pots still on) → tracking continues; turn the network back on, end the session → it saves.
- [ ] Open the app offline → no crash, no forced sign-out, no push into onboarding.

## Backend and deploys

Run the items for any Edge Function that changed in this release.

- [ ] Edge Functions deploy separately from git, so the live version can differ from the repo. Before deploying, compare the two (dashboard → Edge Functions → code, or `supabase functions download` into a **separate clone**, since it overwrites the local file) and make sure the repo version is what you want live.
- [ ] Required secrets are set: `npx supabase secrets list --project-ref <ref>`.
- [ ] Deploy: `npx supabase functions deploy <function-name> --project-ref <ref>` (add `--no-verify-jwt` only for cron-called functions such as `generate-daily-summaries`).
- [ ] **generate-daily-summaries:** smoke test without forcing a run (no Claude calls outside the run hour):
      `curl -X POST "https://<ref>.supabase.co/functions/v1/generate-daily-summaries" -H "Authorization: Bearer <CRON_SECRET>" -H "content-type: application/json" -d "{}"`
      → `200` with `ok: 0` (or `202` during the run hour). Then after the next scheduled run: logs show `done: { …, error: 0 }` (or only a few errors), `daily_ai_summary` has rows for today, and the home screen shows the insight.
- [ ] The cron job that calls `generate-daily-summaries` exists, runs on its expected schedule, and sends `Authorization: Bearer <CRON_SECRET>`.
- [ ] **session-coach:** live insight and end-of-session message work in the app.
- [ ] **delete-account:** deleting the test account signs you out, you can't sign in again, and its data is gone.
- [ ] Know the rollback before deploying: redeploy the previously live version from a separate checkout (`git worktree add <dir> <commit>`).

---

## Maintaining this checklist

- **Adding a feature:** add its checks to the feature's section (or a new section in the same style) in the same change as the feature, so the list stays in step with the code.
- **Release-specific checks** (a risky change, a one-off migration, something to watch after deploy) go in [Release focus](#release-focus) and are cleared once the release ships.
- **Only add what `npm test` can't check:** real hardware, OS behaviour, notifications, real Supabase, deploys, how it looks and feels. If something can be tested automatically, add a test instead.
- **Write each item as an action → expected result**, specific enough that someone new to the app can tell whether it passed.
- **Remove or rewrite items** when a feature is removed or its behaviour changes; a stale check is worse than none.
- **When something fails,** note the item, phone/OS and what you saw (screenshot or log lines), and check Sentry for a matching error before filing it.
