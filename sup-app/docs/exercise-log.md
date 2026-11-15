# Manual exercise log

The fourth bottom tab is Exercise, after Stats. Automatic squat/walk logging is intentionally not connected.

## Database setup

Apply `supabase/migrations/202611150001_exercise_log.sql` through the project's normal Supabase migration process before using this feature against a backend. It has not been applied to a remote database as part of this change. The migration adds a new table and validation function; it does not change existing session tables or records.

Each workout belongs to the signed-in account and saves its exercises atomically in one row. Row-level security restricts select, insert, update and delete to that owner. Account deletion cascades to workouts. Strength values are reps or seconds per set; other activity values are minutes. Dates are calendar days in the device's timezone, not UTC timestamps. The back rating is per workout, not per exercise.

The app reports load/save errors and preserves an open form after a failed save. There is no offline save queue. "Log again" copies exercises into an unsaved form, uses today, and requires a fresh back rating.

## Checks

Run `node --test tests/exercise-log.test.cjs` for date/amount validation, repeat behavior, pagination, owner-scoped storage operations and failure propagation. These tests mock the storage transport; database policies also need verification against a migrated test database.

Before release, check on a device with that database:

1. Open the fourth tab at a narrow phone width; check all six navigation targets and the selected highlight.
2. Log plank (3 × 30 seconds), glute bridge (3 × 12 reps), and yoga (20 minutes) in one workout. Choose a back rating and save. Relaunch and confirm the workout persists.
3. Enter different values per set, a custom strength exercise, and a fractional activity duration. Check the keyboard does not cover Save and that long exercise names wrap.
4. Save with missing/zero/negative values or no back rating; confirm the form remains open with a helpful error. Cancel a dirty form and choose Keep editing, then Discard.
5. Edit a date using the calendar, try a leap day, filter by day, and navigate across month/year boundaries. Swipe the weekly card left for older weeks and right for newer weeks, matching Stats; check short drags snap back, vertical scrolling and day taps still work, and swiping right at the current week stops at the boundary. Future dates must be disabled.
6. Use last values and Log again. Confirm the copied workout is not saved automatically and the rating is unset.
7. Edit and delete a workout, then reload. Delete must require confirmation.
8. Interrupt the connection on save: no success message, form values retained. Restore connectivity and retry.
9. Sign in as a second account; confirm the first account's history is absent. Verify RLS also rejects direct reads/writes to another user's rows.

A full-project TypeScript check already reports pre-existing errors outside this feature. Compare against the pre-change baseline rather than treating those as regressions.
