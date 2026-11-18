# Posture check-in notification

While the app is open or running in the background, a signed-in user gets a "Quick check" notification every 10 minutes:

> Catching your posture during the day is how habits change. How are you sitting right now?

Tapping it opens the check-in screen (`app/(modals)/posture-checkin.tsx`):

| Field | Input |
|---|---|
| How are you sitting right now? | Tap 1 of 6 stick figures: upright, forward lean, slouched, severe, tilted L, tilted R |
| How does your back feel? | 1–5 (stiff → great) |
| Time | Logged as "Now" |

"Log it" saves one row to `posture_checkins` and shows "Posture logged!". "Not now" closes without saving.

## On the exercise log page

Saved check-ins also show on the Exercise tab, by date, next to workouts:

- Each date with check-ins gets a **Posture check-ins** card under that date's workouts. Dates with only check-ins get their own heading too. The card shows the count, the most common posture and the average back rating, then the newest 5 entries (time · posture · back n/5). **Show all** lists the rest.
- A check-in's date is the phone's local calendar day of `logged_at`, the same kind of date key workouts use.
- The week card shows a lighter second dot on days with check-ins, plus "N days with posture check-ins" under the exercise count. The solid dot and "days with logged exercise" stay workouts only. The month calendar marks days with either.
- Picking a day filters check-ins as well as workouts.
- Check-ins load at the same time as workouts but separately. If they fail to load, workouts still show, with a note to pull down and retry. The error is reported to Sentry as `exercise-posture-checkins-load`.
- Answering a check-in while on the Exercise tab refreshes the page when the check-in screen closes.

## The `posture_checkins` table

The table already exists in Supabase. Each row belongs to the signed-in account. RLS lets the owner select and insert only; the app never updates or deletes rows. Account deletion cascades.

Columns:
- `posture`: one of the six values above.
- `back_feel`: 1–5.
- `logged_at`: when the user pressed Log it.
- `notification_sent_at`: when the prompting notification was delivered, or null if the screen was opened another way. Lets you measure response time.
- `source`: `notification` or `in_app`.

## How the notification is sent

- Check-ins work like the posture and session alerts: the **running app** sends them. Nothing is scheduled with the phone's system, so once the app is closed (swiped away or force-stopped), no check-ins arrive.
- `src/components/posture/PostureCheckinScheduler.tsx` (rendered in `app/_layout.tsx`) runs a timer while someone is signed in. Every 30 seconds it checks whether `POSTURE_CHECKIN_INTERVAL_SECONDS` (10 minutes, in `src/services/posture/postureCheckinService.ts`) has passed since the last check-in. If it has, it calls `sendPostureCheckinNotification()`, which shows the notification immediately. Guests get none, because check-ins are saved per account. Signing out stops the timer.
- The first check-in comes 10 minutes after the app starts or you sign in.
- The timer compares against the last send rather than counting ticks. If the phone paused the app for a while, it sends one check-in when the app resumes, not a burst.
- Each check-in uses the same id, so a new one replaces the previous one in the tray instead of piling up.
- On launch, the scheduler removes any check-ins that earlier builds had queued with the phone's system (ids `posture-checkin-0…59` and `posture-checkin-repeating`), so those stop arriving with the app closed.
- On Android the notifications use the high-priority "Urgent Reminders" channel. In expo-notifications 0.32 the channel must be set on the **trigger**, not the content.
- A tap goes through `handlePostureCheckinResponse` in `pushNotificationService.ts`. It opens the check-in screen, clears check-ins from the tray, and returns before the reminder handling, so check-ins never change `behaviour_state` or `reminder_log`.
- If a check-in is still in the tray after the app was closed and the user taps it, the app starts, waits until `app/index.tsx` has finished redirecting, then opens the check-in screen. Responses older than 15 minutes are ignored.

### Known limits

- **Android:** in the background, timers keep running while Android keeps the app alive. Battery saving may delay them or stop the app after a while, especially with the screen off. Setting the app's battery use to Unrestricted helps.
- **iPhone:** iOS pauses an app in the background after a short time unless it has a reason to stay awake, such as a s'pot session streaming over Bluetooth. Without a running session, check-ins usually only arrive while the app is open, plus one when it comes back.
- There is no offline save queue: a failed save keeps the screen open with an error so the user can retry.

## Checks

Run `npm test` from `sup-app` before pushing or merging. `tests/posture-checkin.test.mjs` covers this feature, and `tests/exercise-ui.test.mjs` covers how check-ins appear on the exercise log. See [the test record](posture-checkin-test-results.md) for results and the **Posture check-in notification** section of [the device checklist](device-test-checklist.md) for the manual checks. Background delivery, real taps, the launch from the tray and RLS can only be confirmed on a device.
