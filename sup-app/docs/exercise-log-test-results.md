# Exercise Log pre-merge test record

Updated: 16 November 2026 (Singapore). Branch: `v3/exercise-log`.

## Automated gate — passed

- Ran `npm test` from `sup-app` using Node 26.11.1: **262 passed, 0 failed, 0 skipped, 0 TODO** after merging `origin/main` (`1c595ed`).
- Combined iOS and Android production bundles exported successfully after conflict resolution.
- Exercise Log coverage: **41 tests** (15 model/storage tests and 26 form/calendar/screen/navigation callback tests).
- Combined non-Exercise Log coverage: **221 tests**, including Posture Stories/session replay support, summaries, BLE, calibration, reminders, scoring, authentication and the existing tests for signup, leaderboard, posture stability, press feedback, saved sensors, Sentry reporting, session stats and tutorial routing.
- Regression sensitivity: five temporary, in-memory mutations were independently rejected by the UI suite: reversed swipe direction, removed duplicate-save guard, omitted back-rating validation, removed account-switch save guard, and removed day filtering. No mutation changed product files.
- Lint passes for the added/updated test files.
- Directly executed and verified the local pre-push hook; it runs `npm test` from `sup-app` and rejects a failing suite. No push or merge of the PR into main was performed.

The initial Exercise Log branch-only run on 15 November passed 116 tests. The 16 November conflict resolution brings in the full Posture Stories/main implementation and its test suites. All incoming test files are retained; `npm test` now discovers both `.test.mjs` and `.test.cjs` files recursively. Both sets of device-checklist entries are preserved. The pre-push hook retains its executable permission.

The Desk session summary, replay, persisted summary store and Stats implementation match `origin/main` exactly. Conflict resolution was limited to the shared test command, hook permissions and testing documentation.

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
