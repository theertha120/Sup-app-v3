# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

S'up ("s'up") is a React Native (Expo, managed workflow) mobile app that estimates a user's
sitting posture from two BLE IMU wearables ("s'pots") worn on the upper and lower back, turns it
into a daily 0–100 "s'up s'core," and coaches the user via an AI chat persona ("s'kipper"). Backend
is Supabase (Postgres + Auth + Edge Functions). See `docs/score-methodology.md` for the full,
code-verified scoring spec (SHS, s'train/CPL, sup_score) — treat it as authoritative before
changing any scoring constant, since it's also the source doc for App Store review responses.

## Rules for Claude

- Before modifying code, inspect the relevant files and trace their dependencies/callers.
- Do not make broad architectural changes when a localized fix is sufficient.
- Preserve existing UI, styling, navigation, and behavior unless the task explicitly asks for changes.
- Do not introduce new npm dependencies without first explaining why they are necessary.
- Do not modify `.env` files or expose secrets.
- Do not change Supabase schema or production data unless explicitly requested.
- Do not change scoring constants, posture thresholds, BLE behavior, session lifecycle, or authentication behavior without checking the relevant documentation and call sites first.
- When modifying an existing feature, prefer the existing service/context/component rather than creating a parallel implementation.
- After code changes, run `npx tsc --noEmit` and `npm run lint` when practical.
- When a change intentionally alters tested behaviour, update the test in the same change; never weaken or delete a test just to make it pass.
- When adding or changing a user-facing feature, update `docs/device-test-checklist.md` in the same change with whatever only a real device can check (see "Maintaining this checklist" in that file).
- For UI changes, inspect the complete screen/component before editing rather than modifying only the snippet mentioned in the request.
- For bugs, identify the root cause before applying a workaround.
- Do not silently revert or overwrite unrelated existing changes.
- If the working tree contains user changes, preserve them.
- Do not remove any existing comments, and be concise when adding new comments or documentation.

## Commands

```bash
npm install            # install deps
npx expo start          # start Metro/dev server (scan QR with Expo Go, or press i/a)
npm run android          # expo run:android (native build)
npm run lint              # expo lint (eslint-config-expo flat config)
npx tsc --noEmit          # typecheck
npm run hooks:install     # once per clone: run npm test on every git push
```

Supabase Edge Functions (Deno, not Node — see below) are deployed independently of the app build:

```bash
supabase functions deploy <function-name>          # e.g. session-coach, generate-daily-summaries
supabase functions deploy <function-name> --no-verify-jwt   # only for functions called by cron, not by the logged-in app (e.g. generate-daily-summaries)
```

## Development environment

The primary development environment is Windows with VS Code and PowerShell.

When giving shell commands:
- Prefer PowerShell-compatible commands.
- Do not assume Unix utilities such as `grep`, `sed`, `awk`, or `rm` are available.
- For recursive searching in PowerShell, use `Get-ChildItem` / `Select-String`, or use an appropriate project-aware search tool.

Android builds use the locally installed Android SDK, Java/JDK, Gradle, and Expo native tooling. Before changing Java/Gradle/Android configuration, inspect the existing configuration rather than assuming a standard Expo setup.

### Device testing (Android via EAS dev client)

BLE features require a native dev-client build on a real device — Expo Go is not sufficient.
Testing happens on Android; there is no local iOS build/testing (Windows has no Xcode). Workflow:

1. `npm install` (from the `sup-app` folder)
2. `eas login` (once per machine)
3. `npx expo install expo-dev-client` (only needed if not already installed)
4. `eas build --profile development --platform android`
5. Install the app on the phone from the build URL EAS provides
6. `npx expo start`
7. Open the dev-client app on the phone and scan the QR code to connect to Metro

Rebuild (steps 3–5) only when native dependencies/config change; otherwise steps 6–7 alone are
enough to iterate on JS/TS changes against an already-installed dev client.

### Expo / native development

This project uses Expo tooling but requires native builds/dev clients for BLE functionality.

Do not assume Expo Go is sufficient for features requiring native modules. BLE functionality requires a development build/native build.

When changing Expo/native dependencies:
- Check compatibility with the installed Expo SDK before upgrading.
- Do not independently upgrade Expo, React Native, Android Gradle Plugin, Gradle, Java, or compileSdk unless explicitly requested.
- Treat `package.json`, `app.json`/app.config, `android/`, and Expo config as a coordinated system.

## Architecture

### Path aliases
`@/*` maps to the repo root (`tsconfig.json`). `app/` and `constants/`/`theme/` are imported as
`@/app/...`, `@/constants/env`, etc.; app code under `src/` is imported as `@/src/...`.

### Routing (`app/`)
Expo Router, file-based, typed routes enabled. `app/_layout.tsx` is the root: it nests
`AuthProvider` → `OnboardingProvider` → `TutorialProvider` → `ToastProvider` → `IMUProvider`
around a `Stack`, plus a global `<SignInModal />` rendered outside the Stack so it can appear over
any screen. `(tabs)` is the main bottom-tab group (home/desk/stats/exercise/leaderboard; today's daily summary is a collapsible section on home);
`(modals)` are Stack screens presented as native modals; `onboarding/` and `tutorial/` are their
own nested Stacks. Order of providers matters — `IMUProvider` depends on `useAuth()` from
`AuthProvider`, and must wrap everything since sensor connection state has to survive navigation.

Startup (`app/index.tsx`) verifies the saved login with `getUser()`, then redirects to home or
`onboarding/intro` from `profiles.onboarding`. If `getUser()` returns no user with an error, it
signs out locally (`scope: "local"`). It does this for any error, including a network failure.
`AuthContext.checkAuth()` runs its own `getUser()` in parallel and sets `isAuthenticated` from it.

### Core domain: IMU → posture pipeline
Two BLE devices stream ~10Hz IMU packets via `src/services/BLEService.ts` (a singleton class, not
a hook) into `src/contexts/IMUContext.tsx`, which is the app's central state machine — it owns
calibration, live classification, SHS/CPL accumulation, intervention alerts, and session
lifecycle. Data flow: `BLEService` decodes raw BLE bytes → `src/lib/imuParser.ts`
(`parseIMUPacket`) → `IMUContext` applies EMA smoothing and the user's calibration offset →
`classifySpinePosture()` (also in `imuParser.ts`) turns the two sensors' relative angles into one
of 7 `PostureState`s against **fixed, non-personalized degree thresholds** (calibration only
determines sensor *orientation*/sign per kit, not per-user sensitivity — an earlier per-user
rescaling attempt was reverted; don't reintroduce it). `IMUContext` then runs two independent
per-second accumulators from that state: **SHS** (Spine Health Score, feeds `sup_score`) and
**CPL** (Cumulative Postural Load, branded "s'train" in UI, drives intervention pop-ups) — these
are separate metrics with separate weight tables, see `docs/score-methodology.md` §3–4.

Key invariants in `BLEService`/`IMUContext` worth preserving when touching BLE code (each is
explained in an inline comment at its call site — read it before changing):
- Only one BLE `connect()` op in flight at a time (`withConnectLock()` queue) — parallel connects
  cancel each other on iOS.
- An unexpected disconnect never auto-reconnects; it surfaces a "reconnect or end session?" prompt
  and the app calls `confirmReconnect()`/`cancelReconnect()` — see `BLEService.ts`'s header comment.
- BLE scanning filters only by `SERVICE_UUID` (FFE5), not device name — pilot units are individually
  renamed (see `src/lib/spotNaming.ts`), so a name-prefix filter would silently exclude renamed kits.
- A posture session starts on the first joint packet from both slots and ends only on manual
  disconnect, the "end s'ession" button, or a user choosing "end session" from the reconnect
  prompt (all via `endCurrentSession()`) — never on an in-flight packet arriving during teardown
  (`sessionEndedRef` guards this).
- App backgrounding (incl. screen off) does **not** end the session — it only flushes a snapshot
  (`snapshotCurrentSession()` in the `AppState` listener). If a s'pot drops while backgrounded,
  the normal unexpected-disconnect path applies (gap timed via `disconnectedAtRef` and excluded
  from duration, background notification + reconnect prompt). `isBackgroundEnabled`/`central` in
  `app.json` only affects iOS. There is no Android foreground service, so with the screen off
  Android may freeze JS after a few minutes, or kill the app, while BLE stays connected. A freeze
  is not recorded as a gap: session duration includes it, and the first packet after resume folds
  the whole pause into the upper-back time-weighted average.
- RN pauses JS timers while backgrounded, but BLE packets keep arriving. The SHS/CPL/display
  ticks are therefore also driven from the packet handler (`runDueTicks`, time-gated so the 250ms
  interval and packets share one schedule). The 20s `posture_sessions` snapshot (`SNAPSHOT_TICK_MS`)
  and `useSessionStats`' totals/timeline are still `setInterval`-only. While backgrounded,
  `ended_at`/`state_totals` stop updating after the background flush. On resume, the first
  `useSessionStats` tick credits the whole background period to the posture at that moment.

### AI coach ("s'kipper") — client never talks to Anthropic directly
`src/services/ai/claudeProvider.ts` calls `supabase.functions.invoke("session-coach", …)` —
**never** `api.anthropic.com` from the client. The Anthropic key lives only in the
`session-coach`/`generate-daily-summaries` Edge Functions (`ANTHROPIC_API_KEY` via `Deno.env`). This
was reverted once already after an accidental merge put a direct client-side Anthropic call back
in with an unset `EXPO_PUBLIC_ANTHROPIC_API_KEY` (silently 401'd) — see the comment at the top of
`claudeProvider.ts` and `supabase/functions/session-coach/index.ts`. Any change to AI-calling code
must keep the network call server-side.

### Supabase Edge Functions (`supabase/functions/`)
These are **Deno** runtime, not Node — separate module resolution from the RN app (imports via
`https://esm.sh/...` per-function `deno.json`, not `package.json`/npm). VS Code's Deno LSP is
scoped to this directory only (`.vscode/settings.json`). Functions: `session-coach` (live AI
insight/summary during a session, JWT-verified — called by the logged-in app), 
`generate-daily-summaries` (cron-triggered, deployed `--no-verify-jwt`, does its own auth check),
`check-email` / `delete-account` (auth-adjacent utilities called from `AuthContext.tsx`).

### Data layer
No local Supabase migrations directory in this repo — schema changes are made directly against the
linked project. Tables referenced from the client (see `src/services/*/` for query call sites):
`posture_sessions` (one row per tracked session, written by
`src/services/posture/postureSyncService.ts`'s `startSession`/`endSession`), `posture_daily` (one
row per user per local day, rebuilt from `posture_sessions` after each session via
`rebuildDailyFromSessions` — this is the source for `sup_score`, streaks, and the stats screens),
and `profiles` (streak/timezone/settings). Dates for streaks and daily rollups use the **device's
local calendar day**, not UTC — see `getLocalDateKeys()` in `postureSyncService.ts`.

### Services layout (`src/services/`)
Grouped by domain, not by type: `ai/` (s'kipper), `posture/` (session sync, daily rollups, caching),
`reminder/` (push notifications + the reminder-timing engine), `session/`, `social/` (friends,
leaderboards), `user/` (profile, settings, timezone), plus `BLEService.ts` at the top level.
`src/lib/` is for pure, React-free logic shared across services/components (`imuParser.ts`,
`qrPairing.ts`, `spotNaming.ts`, `supabase.ts` client init, `timezoneUtils.ts`) — new
non-React helpers belong there, not in `services/`.

### Sensor pairing
Pilot units are pre-registered offline via `scripts/witmotion_pairing_tool.py` (Python, runs on the
operator's laptop, not part of the app build) which prints a QR per kit encoding
`{pair_id, top: name, bottom: name}`. The app matches by **advertised BLE name**, never MAC/UUID —
iOS has no API to read or connect by a peripheral's real MAC address (OS-level privacy
restriction, not a library limitation), so name is the only identifier consistent across
scanning platforms. See `docs/qr-pairing-plan.txt` for the full rationale and `src/lib/qrPairing.ts`
/ `src/lib/spotNaming.ts` for the parsing logic.

### Environment
Two Expo public env vars, read in `constants/env.ts`: `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY` (in `.env`, gitignored). Because `EXPO_PUBLIC_*` vars are compiled
into the shipped client bundle, never add a secret (API key, service-role key) under that prefix —
secrets belong in Edge Function environment (`Deno.env`), set via `supabase secrets set` /
EAS environment, not `constants/env.ts`.


## Known pitfalls

- BLE native functionality does not work correctly in Expo Go; use a development build.
- `react-native-ble-plx` requires native modules.
- Do not use device-name filtering based on a fixed prefix because pilot devices can be renamed.
- iOS does not expose peripheral MAC addresses to the app; pairing uses advertised BLE names.
- BLE connect operations must not run concurrently.
- Unexpected BLE disconnects require user confirmation before reconnecting.
- Do not reintroduce direct Anthropic API calls into the RN client.
- `EXPO_PUBLIC_*` variables are public and must never contain secrets.
- Supabase Edge Functions use Deno, not the RN Node/npm environment.
- PowerShell is the primary shell on Windows; Unix-specific commands may not exist.
- Android/Gradle/Java versions must be treated as a compatibility set.
- No local iOS build/testing exists (Windows, no Xcode) — Android via EAS dev client is the only device-testing path; do not suggest `expo run:ios` or simulator-based iOS testing.