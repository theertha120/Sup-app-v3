# Tests

Run in `sup-app` before pushing or merging:

```sh
npm test
```

Tested with Node 26.11.1. Node must support built-in TypeScript stripping (22.6+ with the supplied flag). No added npm dependencies. Tests use Node's runner and the existing TypeScript compiler; native modules, network calls and Supabase are faked.

Run just the Exercise Log tests:

```sh
node --experimental-strip-types --no-warnings --test tests/exercise-log.test.cjs tests/exercise-ui.test.mjs
```

Install the repository's optional pre-push check once per clone:

```sh
npm run hooks:install
```

The hook runs `npm test` from `sup-app` and blocks a push if tests fail. It does not push anything and does not replace manual device testing or enforce remote merges. Run the tests again on the final merged code before merging into main.

## Coverage on this branch

| File | Coverage |
| --- | --- |
| `exercise-log.test.cjs` | Workout validation, dates, amounts, formatting, repeat copies, owner-scoped storage queries, paging and error propagation |
| `exercise-ui.test.mjs` | Real form/screen/calendar callbacks: manual entry, custom exercises, varied sets, ratings, retry, duplicate-save guard, edit/delete/repeat, day filtering, account changes, swipe direction/bounds/interruption, month selection and tab order |
| `check-email.test.mjs` | Email checks and signup routing |
| `leaderboard.test.mjs` | Leaderboard calculations and loading |
| `posture-stability.test.mjs` | Posture stability rules |
| `press-feedback.test.mjs` | Press appearance and disabled controls |
| `saved-devices.test.mjs` | Saved sensor handling |
| `sentry-logging.test.mjs` | Error reporting and throttling |
| `session-stats.test.mjs` | Shared session tracking and persistence errors |
| `tutorial-skip.test.mjs` | Tutorial skip routing |

`helpers/harness.mjs` loads real TypeScript modules with explicit mocks and deterministic hooks/timers. Unmocked external imports fail rather than contacting a service. The Exercise Log UI tests exercise component state and callbacks, not native pixels, real touch gestures or an actual database.

The checklist and shared helper were recovered from commit `aedbf4b` on `origin/v3/postureStories`. This branch does not include that branch's unrelated feature changes or its feature-specific suites. The existing signup and tutorial fixtures were updated from that commit to match callbacks already present here; no product code was changed to make the tests pass.

Use [the device checklist](../docs/device-test-checklist.md) for real-device checks, and [the Exercise Log test record](../docs/exercise-log-test-results.md) for this change's outstanding sign-off.
