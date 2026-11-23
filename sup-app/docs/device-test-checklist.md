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
- [ ] **Navigation regression:** all five tabs open the right screen (there is no separate Daily tab); Exercise is fourth, immediately after Stats; the selection highlight fits a narrow phone.
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

## Live s'ession notification (Android)

The Android foreground service's pinned notification (see "Background tracking" below) shows the running session's time, posture and XP, like a ride-status notification. There is only **one** pinned notification: src/components/desk/SessionLiveNotification.tsx updates the service's own notification. Android only for now.

- [ ] **Appears:** connect both s'pots → a silent "s'pots connected · starting your s'ession…" notification. Once the session starts it becomes "s'ession in progress · 0min" with "🟢 good alignment · 0 xp so far" (or your current posture). No second notification, and no sound, vibration or banner, including while the app is open.
- [ ] **Updates in place, quickly:** lean forward / slouch / tilt → the line changes as soon as the app confirms the new posture (the same moment the Desk figure changes; nothing extra is added for the notification), in the same notification (not a new one). Check this with the app **in the background and the screen off** too — it should keep changing, not only when you reopen the app. Minutes tick up; XP goes up 5 every 10 minutes. Record how it behaves with the screen off and the app in the background for 10+ minutes.
- [ ] **Swiping it away:** on Android 13+ the notification can be swiped away, but it should **come straight back** with the same text. On older Android it can't be swiped at all. After the session ends it must not come back. Tapping it opens the app (on the screen you were last on) and it stays pinned.
- [ ] **Disconnect:** turn a s'pot off → "⚠️ a s'pot disconnected — open s'up to reconnect". Reconnect → posture line returns.
- [ ] **Ends:** end the s'ession (button, disconnect, or "end session" on the prompt) → the notification disappears.
- [ ] **App swiped away mid-session:** the notification goes away with the app (the service doesn't restart on its own).
- [ ] **Notifications off** for the app → no crash; sessions still work (record whether Android still shows the service notification).
- [ ] **Channel:** Android Settings → s'up → Notifications shows the "posture tracking" category. If you tried an earlier test build, the old "Live s'ession" category is gone after opening this one.

## Live s'ession Live Activity (iPhone)

The same live status on iPhone, as a Live Activity on the lock screen and in the Dynamic Island (iOS 16.2+; Dynamic Island on iPhone 14 Pro or later). Native code: modules/sup-foreground-service/ios + the widget in targets/sup-live-activity. Needs a **new EAS iOS build** — the first one creates a provisioning profile for the new widget bundle id (com.supapp.app.liveactivity), so run it interactively once.

- [ ] **Appears:** connect both s'pots with the app open → a Live Activity "s'pots connected · starting your s'ession…" on the lock screen. Once the session starts: "s'ession in progress · 0min" / "🟢 good alignment · 0 xp so far", with a seconds timer in the corner that counts up by itself.
- [ ] **Dynamic Island** (14 Pro+): compact shows the posture dot and the timer; long-press expands to the title and posture line.
- [ ] **Updates in the background:** lock the phone, change posture → the lock-screen text changes about as fast as the Desk figure would. Leave it 10+ minutes → minutes and XP go up.
- [ ] **Disconnect:** turn a s'pot off → "⚠️ a s'pot disconnected — open s'up to reconnect".
- [ ] **Ends:** end the s'ession → the Live Activity disappears.
- [ ] **App closed mid-session:** swipe the app away → within ~2 minutes it shows "open s'up to keep tracking" (stale), and the "your s'ession has ended" notification still arrives.
- [ ] **Dismissed by the user:** swipe the Live Activity away on the lock screen → it comes back the next time the app is opened during that session (iOS doesn't allow starting one from the background).
- [ ] **Live Activities turned off** (Settings → s'up → Live Activities) → nothing shows, no crash, the session still tracks.
- [ ] **Older iPhone / iOS below 16.2** → app installs and runs normally, just without the Live Activity.

## Background tracking (ported from v2)

Android foreground service (`modules/sup-foreground-service`) and the iOS background fixes from the v2 repo (commits 3b42ae9, 0d1319b, 54c12d7, a704b80, 81ecd0a). Needs a **new native build** (EAS / `expo run`); a Metro reload isn't enough.

- [ ] **Android foreground service:** connect both s'pots → the silent pinned notification appears ("s'pots connected · starting your s'ession…", then the live session status; Settings → s'up → Notifications shows a "posture tracking" channel). Lock the screen for 15+ minutes → the session keeps tracking and saving. End the session → the notification goes away.
- [ ] **Android unexpected drop:** turn a s'pot off mid-session → the service stays up while the reconnect prompt is open; "end s'ession" stops it.
- [ ] **iOS background:** start a session, lock the phone for 15+ minutes with the s'pots streaming → the app isn't killed (no cpu_resource_fatal in crash logs) and the session keeps its time.
- [ ] **iOS relaunch (state restoration):** with a session running, let iOS end the app in the background (or relaunch it via Bluetooth) → the same session carries on, not a new one, if it's back within ~90 s; otherwise the old session is closed and saved and a new one starts.
- [ ] **"Session ended" safety net:** force-close the app mid-session → about 90 s later a "session ended" notification arrives. Reopen → that session shows as completed and its day is rebuilt.
- [ ] **Stalled data:** stop the s'pots sending data without disconnecting (e.g. out of range without a drop) → after ~75 s the session is ended and saved.
- [ ] **Offline cold start:** with no connection, fully close and reopen the app → you stay signed in (no logged-out flash, no sign-out).
- [ ] **Android: one pinned notification** during a session (the foreground service's, showing the live status). No separate "s'up is tracking your posture" notification.

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
- [ ] Wait ~10s after ending, open **Home** and expand **see today's data** → today's s'up s'core and minutes updated.
- [ ] **Stats week** → last bar is today; labels are the real weekdays.
- [ ] **Stats month** → wk 1–4, plus wk 5 only if the month has a 29th; tap a bar → correct date range.
- [ ] **Stats year** → each month's bar matches that month.
- [ ] On each stats card, dragging **right** shows older data (the older page slides in from the left), dragging left goes back to newer; past the newest/oldest page the card only rubber-bands. Vertical scrolling still works.
- [ ] A session that runs **past midnight** shows under the day it started.
- [ ] **Leaderboard** → your score appears; ranks look right.

## Exercise Log

Use a test account and test database with `202611150001_exercise_log.sql` applied. Test on Android and iOS when available. All boxes below are intentionally unchecked until a person observes the result on a device.

- [ ] **Page appearance:** open Exercise → the week card has space above it; no page title/subtitle or All/Strength/Other filter row. Fonts/colours match Sup. At larger text sizes and narrow widths, labels remain readable and the bottom bar does not cover history.
- [ ] **Swipe feel:** swipe right → older week (slides in from the left); left → newer week; left at this week → resists and stays put. Short drags snap back. Fast flicks advance one week. Vertical scrolling and tapping a day still work. Only “swipe right for older data” appears as the hint.
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
- [ ] **Loads at login:** sign in (or relaunch while signed in), wait a few seconds on Home, then open Exercise → workouts and posture check-ins are already there with no loading spinner. Log a workout, switch tabs and come back → it is still there. Sign out and in as another account → the first account’s history never appears, even briefly.

## Daily goals

Use a test database with `202611200001_daily_goals.sql` applied.

- [ ] **Goal set:** an account with no posture sessions sees posture and exercise goals only; after its first s'pot session, returning to Home also shows sitting goals.
- [ ] **Offers:** each section shows one easy, one medium and one hard goal. They stay the same after relaunch the same day and change after local midnight (reopen Home).
- [ ] **Across midnight:** leave Home open with an unfinished goal past local midnight → within a minute the new day's offers show, "your goals" empties, and yesterday's goal is not marked complete. Tapping an old offer just before the switch reloads instead of adding it.
- [ ] **Pick and remove:** pick goals from different sections and difficulties → they appear under "your goals" with a progress bar and "x / y" count. The ✕, or tapping the picked offer again, removes an unfinished goal; a completed one can't be removed.
- [ ] **Auto-complete, check-ins:** pick a posture check-in goal (e.g. respond to 2 check-ins), then tap "done" on real check-ins → progress rises on returning to the app and the goal moves to "s'goals completed" with no tap needed. Dismissing a check-in doesn't count, and "without dismissing any" goals show it's no longer possible.
- [ ] **Auto-complete, exercise:** pick an exercise goal, log a matching workout dated today in Exercise, go back to Home → it completes. A workout dated an earlier day doesn't count.
- [ ] **Auto-complete, desk mode:** pick a sitting goal (hardware account), track and end a desk session long enough → back on Home it completes within about a minute. A session still in progress doesn't count until it's ended.
- [ ] **Reminder settings:** on light reminders with only the morning preset, no posture goal asks for more than 3 check-ins or for check-ins outside the morning. With reminders off, a no-hardware account sees "turn on reminders in settings" under posture. Block the app's notifications in Android settings and reopen Home → no check-in goals are offered (the engine still logs check-ins it can't show). The check-in buttons read "Yuh / Nuh / Ugh", matching the goal text.
- [ ] **Collapsed by default:** open today's data, switch tabs and come back (and relaunch) → Home shows "see today's data" collapsed; the "your goals" and "pick your goals" cards sit under "today:" with the other cards, in the same fonts and sizes.
- [ ] **Explainers:** the "?" on "your goals" (explains auto-completion and where each section's data comes from), on "s'goals completed" and next to "completed goals" on the history screen each open the right explanation; "got it" closes it.
- [ ] **History:** "history of completed goals" opens the history screen grouped by day, newest first; persists after relaunch and sign-out/sign-in; a second account doesn't see the first's goals. Scroll down to the link, open history and tap the back arrow → Home shows at the top with today's data collapsed and everything visible, without touching the screen (same after switching tabs while scrolled down).
- [ ] **Layout:** with today's data open, the last goal card clears the floating nav bar; the home tutorial's "see today's data" tip still scrolls into view.
- [ ] **Offline:** picking with no network shows an error and no false success; progress just stops updating until the network returns.

## Reminders and notifications

- [ ] First launch → notification permission prompt. Deny → app still works.
- [ ] Inside your active hours, a **reminder** arrives at the expected interval.
- [ ] Reminder buttons **Yuh / Nuh / Ugh** each dismiss it; three "Ugh"s → the "We hear you!" message.
- [ ] Outside your active hours → no reminders.
- [ ] Leave the app → log shows `Re-engagement reminder scheduled for <~48h later, inside active hours>`. Reopen and leave again → a new time is logged (it replaces the old one).
- [ ] To see the re-engagement reminder fire without waiting 48h: in a dev build, temporarily shorten `RE_ENGAGEMENT_AFTER_MS` in `reminderEngineService.ts` (e.g. 2 minutes), leave the app and wait → notification arrives; tapping it adds a `reminder_log` row with `reminder_type = re_engagement`. **Revert afterwards.**
- [ ] Sign out and leave the app → no re-engagement reminder arrives for the old account.

## Posture check-in notification

Use a test account. Test on Android and iOS when available. Leave every box unchecked until a person observes the result on a device.

- [ ] **Starts on open:** open the app while signed in → Metro shows `[notif] posture check-in: signed in → every 600s while the app runs`.
- [ ] **App open:** keep the app open → a "Quick check" notification (banner) arrives about every 10 minutes, the first about 10 minutes after opening.
- [ ] **App in the background:** go to the home screen without closing the app → check-ins keep arriving about every 10 minutes. Record the phone model and how long they kept coming with the screen off. On iPhone, record the result both with and without a s'pot session running.
- [ ] **App closed:** swipe the app away (or force-stop it) and wait 25+ minutes → **no** check-ins arrive.
- [ ] **Only one in the tray:** leave two check-ins unanswered → only the latest is in the tray.
- [ ] **Upgrade from an earlier build:** on a phone that ran the earlier queued version, install this build, open it once, then close it → no more check-ins arrive while it's closed.
- [ ] **Tap from background:** tap one → the check-in screen opens over the current tab with 6 stick figures, a 1–5 rating and "Now · <time>". The check-in is cleared from the tray.
- [ ] **Tap after closing:** with a check-in still in the tray, swipe the app away, then tap the check-in → the app starts, finishes its normal startup (home/onboarding), then opens the check-in screen once.
- [ ] **Stick figures:** each of the 6 figures is clearly different and matches its label; Tilted L leans left, Tilted R leans right. The selected one is highlighted. Labels stay readable on a narrow phone and at large text sizes.
- [ ] **Logging:** Log it is disabled until a figure and a rating are picked. Log it → "Posture logged!" message and the screen closes. In Supabase, one `posture_checkins` row with the right posture, `back_feel`, `logged_at` ≈ when you pressed Log it, `notification_sent_at` ≈ when the notification arrived, and `source = notification`.
- [ ] **Not now:** closes without adding a row.
- [ ] **Connection lost:** turn off the network and press Log it → error shown, screen stays open, no "Posture logged!". Turn it back on and retry → exactly one row.
- [ ] **Not a reminder:** tapping a check-in does not change `behaviour_state` counts or add a `reminder_log` row. Yuh/Nuh/Ugh reminders still work as before.
- [ ] **Signed out:** sign out → no more check-ins arrive (wait 15 min). Sign back in → they start again 10 minutes later.
- [ ] **Permission denied:** deny notifications → no check-ins and no crash; Metro shows `no permission, not sent`.
- [ ] **Account separation/RLS:** as a second test account, authenticated requests cannot read or insert the first account's check-ins. Dashboard admin visibility does not prove RLS works.
- [ ] **Alongside a session:** with a s'pot session running, answer a check-in → Desk tracking continues uninterrupted.
- [ ] **On the exercise log:** open Exercise → today shows a **Posture check-ins** card with the right count, most common posture, average back rating and the newest 5 entries. Show all / Show less work. A day with only check-ins has its own heading.
- [ ] **Exercise calendar dots:** days with check-ins have a lighter second dot and the week card says "N days with posture check-ins". "Days with logged exercise" still counts workouts only. Tapping a day shows only that day's workouts and check-ins.
- [ ] **Around midnight:** answer a check-in shortly after local midnight → it appears under the new day, not the day before.
- [ ] **Refresh after answering:** with Exercise open, answer a check-in from the notification → after closing the check-in screen, the new entry is on the Exercise page.
- [ ] **Load failure:** with the network off, Exercise still shows workouts with a "couldn’t load your posture check-ins" note. Pull to refresh once fixed → check-ins appear.

## s'kipper (AI coach)

- [ ] During a session, a live s'kipper insight appears.
- [ ] At the end of a session, the s'kipper message appears in the summary.
- [ ] Home shows today's daily insight (or yesterday's if today's isn't generated yet).
- [ ] Home → **see today's data** below the insight expands today's s'napshot, s'ession and s'core and scrolls them into view above the navbar; tap again (**hide today's data**) to collapse. ⓘ popups and % badges work as before.
- [ ] Tutorial on Home: the "see today's data" tip opens the section and shows the s'napshot tips in place, then "s'goals completed", picking goals and "history of goals" — each tip scrolls into view with its card highlighted (for "history of goals", the link itself is on screen above the tip); "got it" on the last one scrolls back up to the settings prompt in the header; "skip page" on any Home tip goes straight to the settings prompt.

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
