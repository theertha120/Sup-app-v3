# Exercise Log pre-merge test record

Date: 15 November 2026 (Singapore). Branch: `v3/exercise-log`.

## Automated gate — passed

- Ran `npm test` from `sup-app` using Node 26.11.1: **116 passed, 0 failed, 0 skipped, 0 TODO**.
- Exercise Log coverage: **41 tests** (15 model/storage tests and 26 form/calendar/screen/navigation callback tests).
- Existing branch coverage: **75 tests** for signup, leaderboard, posture stability, press feedback, saved sensors, Sentry reporting, session stats and tutorial routing.
- Regression sensitivity: five temporary, in-memory mutations were independently rejected by the UI suite: reversed swipe direction, removed duplicate-save guard, omitted back-rating validation, removed account-switch save guard, and removed day filtering. No mutation changed product files.
- Lint passes for the added/updated test files.
- Directly executed and verified the local pre-push hook; it runs `npm test` from `sup-app` and rejects a failing suite. No push or merge was performed.

The shared harness and device-checklist template came from `aedbf4b` on the separate `origin/v3/postureStories` branch. That branch also has suites for product changes absent here; those suites and product changes were not merged. Two stale fixtures already on this branch (signup callback dependencies and removed tutorial props) were brought up to date without changing product behavior.

These tests execute the actual component callbacks with mocked hooks, native UI and network/storage dependencies. They do not prove rendered layout, real touch gestures, OS keyboard behavior, actual Supabase persistence or deployed RLS policies.

## Device gate — NOT RUN / awaiting device

- Device discovery found no connected physical iPhone; the known phone was offline. No physical Android test device was available through the installed tooling.
- Build/device/OS/s’pot-kit record: pending.
- Supabase migration and two-account RLS verification: pending.
- All Exercise Log, navigation regression and applicable hardware checks in [device-test-checklist.md](device-test-checklist.md) remain unchecked.
- The network-reconnection case especially needs a device check: the app-wide OfflineGate can remount screens, which the isolated form tests do not simulate.

**Merge readiness: automated checks pass; manual device and database sign-off are still outstanding.** Do not treat this record as a completed device test. Run `npm test` again after any further change or merge and record the actual device results below.

## Manual execution record

| Date / tester | Build / commit | Device / OS / kit | Checklist item | Observed result / evidence |
| --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Exercise Log release focus and affected feature sections | Not run — no connected physical test device |
