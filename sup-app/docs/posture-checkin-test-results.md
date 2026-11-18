# Posture check-in notification test record

Updated: 18 November 2026 (Singapore). Branch: `v3/posture-notif-logs`.

## Automated gate — passed

- Ran `npm test` from `sup-app` using Node 24.13.0: **302 passed, 0 failed, 0 skipped, 0 TODO** (after switching check-ins to the in-app timer).
- Posture check-in coverage: **40 tests**: 35 in `tests/posture-checkin.test.mjs` and 5 in `tests/exercise-ui.test.mjs`.
- Exercise log page (5 in `exercise-ui.test.mjs`, 6 in `posture-checkin.test.mjs`):
  - check-ins grouped under their phone-local date, including days with no workout, newest first;
  - separate calendar dot and count, so the workout count is unchanged;
  - the day filter applies to check-ins too;
  - a check-in load failure keeps workouts, shows a note and reports to Sentry;
  - switching accounts hides the old account's check-ins;
  - fetching pages past 500 rows, scoped to the user, and throws errors;
  - day card summary (count, most common posture, average back), newest 5 then Show all / Show less, singular wording;
  - check-ins just after and just before local midnight stay on the local day.
- Notification feature (29 in `posture-checkin.test.mjs`):
  - 5 for saving a check-in (row contents, `in_app` source, signed-out, database error reported to Sentry, 10-minute interval);
  - 9 for sending and tap routing:
    - shown immediately, with nothing queued for later (Android channel, iOS null trigger);
    - a new check-in replaces the previous one in the tray;
    - permission denied;
    - cleanup of check-ins earlier builds queued with the OS, leaving other reminders alone;
    - a tap opens the screen with the sent time and clears the tray;
    - a duplicate tap opens once;
    - other notifications are ignored;
    - check-in taps don't touch `behaviour_state`/`reminder_log`.
  - 8 for the scheduler component:
    - every 10 minutes from the app's own timer, none before;
    - sign-out stops it, guests get none;
    - no more once the app is closed (timer cleared);
    - one check-in, not a burst, after the app was paused;
    - old queued check-ins cleared once per launch;
    - launch from the tray waits for routing;
    - late launch response;
    - stale/other launch responses ignored.
  - 6 for the check-in screen (six figures/rating/Now shown, Log it disabled until answered, save + "Posture logged!" + close, failed save keeps the screen and retries the same answers, Not now, opened without params);
  - 1 for the stick figures (all six differ; only the tilts lean, in opposite directions).
- The exercise screen's existing test helper now also fakes the check-in service, Sentry and the day card; all 26 earlier Exercise Log UI tests still pass unchanged.
- `tests/reminder-engine.test.mjs` now also fakes `@/src/lib/sentry`, because the notification service imports the check-in service, which reports save errors to Sentry.
- Regression sensitivity: temporary, in-memory mutations (no product files changed) were run against the suite.
  - Tap and screen, all caught:
    - check-in tap falling through to reminder handling;
    - removed duplicate-tap guard;
    - cleanup removing every scheduled notification;
    - Log it enabled before answering;
    - screen not closing after a save;
    - opening the screen during startup routing;
    - saving while signed out;
    - Tilted L leaning the wrong way.
  - In-app timer, all six caught:
    - timer not cleared when the app closes;
    - running while signed out;
    - a burst after a pause;
    - sending on every tick;
    - a repeating OS notification instead of an immediate one (would arrive with the app closed);
    - no fixed id (check-ins pile up in the tray).
- Exercise log mutations, all eight caught:
  - check-in-only days dropped;
  - day filter ignoring check-ins;
  - a check-in error hiding the workout history;
  - check-in days counted as exercise days;
  - another account's check-ins shown;
  - Show all preview removed;
  - check-ins dated by UTC instead of the phone's local day;
  - the check-in count line shown when there are none.

  The UTC-date mutation was missed at first, because the test time didn't cross a UTC date in Singapore. The test now checks times just after and just before local midnight.

These tests run the real service, component and screen code with faked expo-notifications, timers, routing, Supabase and React Native. They do not prove how long a real phone keeps the app's timer running in the background, real taps, rendered layout or RLS policies.

## Device gate — NOT RUN / awaiting device

- History: a repeating OS trigger didn't fire on the user's Android phone, so an OS-queued batch was tried next. That was then replaced by the in-app timer, so that check-ins only arrive while the app is open or in the background, like the session alerts. In-app timer delivery has not yet been recorded on a device.
- Two-account RLS verification on the existing `posture_checkins` table: pending.
- All items in the **Posture check-in notification** section of [device-test-checklist.md](device-test-checklist.md) remain unchecked.

**Merge readiness: automated checks pass; device and database sign-off are still outstanding.** Run `npm test` again after any further change or merge and record device results below.

## Manual execution record

| Date / tester | Build / commit | Device / OS | Checklist item | Observed result / evidence |
| --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Posture check-in notification section | Not run |
