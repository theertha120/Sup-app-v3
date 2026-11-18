# Tests

Run from `sup-app/`:

```powershell
npm test                                   # whole suite (~10s)
node --experimental-strip-types --no-warnings --test tests/imu-session.test.mjs   # one file
npm run hooks:install                      # once per clone: run npm test before every git push
```

Requires Node 22.6+ (uses Node's built-in `node:test` runner and TypeScript type
stripping). No extra npm dependencies, no device, no network, no real Supabase.
The test command discovers both `.test.mjs` and `.test.cjs` files recursively,
so the Posture Stories and Exercise Log suites run together. Run the tests on
the final combined code before pushing or merging. The hook blocks a failing
local push but does not replace manual device checks or enforce remote merges.

To run just Exercise Log:

```sh
node --experimental-strip-types --no-warnings --test tests/exercise-log.test.cjs tests/exercise-ui.test.mjs
```

## What's covered

| File | Protects |
|---|---|
| `imu-session.test.mjs` | Session lifecycle in `IMUContext`: start on first joint packet, backgrounding only snapshots, disconnect gap excluded from duration, reconnect prompt, deliberate end + 5s daily rebuild, post-end packet suppression, SHS/CPL ticking, grace periods, s'train intervention |
| `calibration.test.mjs` | 5-step calibration: neutral capture, kit-orientation detection (worn either way), low-confidence redo, no-data steps, persistence + reload, reset, s'train pop-up answers |
| `auth.test.mjs` | `AuthContext` (startup, auth events, streak re-check, login/sign-up/OTP, logout, delete account), profile creation after email verification, startup routing in `app/index.tsx`, `profileService` reads/updates/validation |
| `daily-summaries.test.mjs` | `generate-daily-summaries` Edge Function: cron secret, 8am SGT gate, SGT dating, 7-day prompt, idempotent re-runs, Claude retries, >1000-user paging, 200-user hand-off |
| `ble-service.test.mjs` | `BLEService`: service-UUID-only scan, one connect in flight, no auto-reconnect, de-duped drops, user-confirmed reconnect + backoff, manual disconnect never prompts |
| `scoring.test.mjs` | `sup_score` worked examples from `docs/score-methodology.md`, classification bands, calibration = orientation only, SHS/CPL constants, packet parsing |
| `posture-sync.test.mjs` | `posture_sessions` / `posture_daily` writes, daily rebuild aggregation, stale-session recovery, local-day streaks |
| `stats-pages.test.mjs` | Stats week/month/year bucketing (incl. wk 5 only when the month has a 29th) |
| `reminder-engine.test.mjs` | Active hours, cooldowns, daily caps, re-engagement, encouragement spacing, no-repeat content |
| `lib-helpers.test.mjs` | Date keys, formatting, QR/s'pot name parsing, session highlights/comparison, onboarding archetype, caches |
| `architecture-guards.test.mjs` | CLAUDE.md "never reintroduce" rules: no client-side Anthropic calls, no secret `EXPO_PUBLIC_*` vars, no BLE name-prefix filter, provider order, BLE background mode |
| `exercise-log.test.cjs` | Manual workout validation, repeat copies, account-scoped storage queries, pagination and failures |
| `exercise-ui.test.mjs` | Form and history callbacks, custom exercises, per-set values, retry/double-save protection, edit/delete/repeat, account switching, date selection, weekly swipes and fourth-tab navigation |
| `posture-checkin.test.mjs` | "Quick check" posture notification: saving to `posture_checkins` (signed-out/errors), immediate send while the app runs (nothing queued with the OS, one in the tray, permission, clearing old queued ones), the 10-minute in-app timer (sign-in/out, stops when closed, no burst after a pause), tap routing and de-duplication, not touching reminder stats, launch from the tray, check-in screen (disabled until answered, save, retry, Not now), stick figures, reading check-ins back (paging, errors) and the exercise-log day card. `exercise-ui.test.mjs` also covers check-ins on the Exercise page (grouping by local date, calendar dots/counts, day filter, load failure, account switch) |
| older files | check-email, leaderboard, posture stabiliser, press feedback, saved devices, Sentry logging, Desk session stats, tutorial skip |

Tests marked `# TODO` in the output are **known bugs** written as tests. They
run but don't fail the suite; remove the `todo` option once the bug is fixed.

## How the tests load app code

`helpers/harness.mjs` transpiles the real `.ts/.tsx` source and runs it with
every native or network import replaced by an explicit fake (`loadTs`). An
import that isn't mocked throws `Unmocked import "…"`, so if you add a new
dependency to a tested module, add a fake for it in that test. Other helpers:
`fakeClock` (controls `Date` and timers), `fakeSupabase` (records every query),
`fakeAsyncStorage`, `miniReact` (runs hook-based providers without React
Native), `imuPacket` (builds a real 20-byte s'pot packet), and
`extractDeclarations` (pulls pure helpers out of a screen file).

These are logic tests. They don't render UI or talk to real hardware, so BLE
behaviour on a phone still needs a device check: see
[`docs/device-test-checklist.md`](../docs/device-test-checklist.md).

See [the Exercise Log test record](../docs/exercise-log-test-results.md) and [the posture check-in test record](../docs/posture-checkin-test-results.md) for automated results and outstanding device/database checks.

To run just the posture check-in notification:

```sh
node --experimental-strip-types --no-warnings --test tests/posture-checkin.test.mjs
```
