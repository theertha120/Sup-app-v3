# App Review response — round 3 (main-apple)

Draft reply + what changed in the build, per guideline. Paste the "Reply" blocks into
App Store Connect; the "Build changes" bullets are what's actually in this branch.

---

## 2.5.4 — bluetooth-central background mode

**Build changes:** none needed to the declaration — the app genuinely uses Core Bluetooth
(via react-native-ble-plx). What changed is that it now actually *uses* the background mode:
sessions no longer end when the app is backgrounded; the s'pots keep streaming and s'up keeps
tracking, and a local notification is sent if a posture reminder fires while backgrounded.

**Reply:**
> s'up pairs with two small Bluetooth Low Energy motion-sensor modules ("s'pots") worn on the
> back, and reads their orientation data over Core Bluetooth (central role). The
> bluetooth-central background mode keeps that connection streaming while the user works in
> another app or locks their phone during a desk session. A screen recording on a physical
> device is attached in the Notes field showing: scanning/pairing (Settings → s'pot setup →
> "s'can to pair"), both s'pots connecting, live posture data updating on the Desk tab, and the
> data continuing after backgrounding the app.

**To do before resubmitting:** record that on a real iPhone with real s'pots (reviewers don't
have the hardware). Suggested: 1) s'pot setup → pair via QR, 2) Desk tab with live figure,
3) lock/background for ~30s, reopen — session still running.

---

## 2.5.1 — HealthKit

**Build changes:** s'up does not use HealthKit on iOS. The `react-native-health` package (which
linked HealthKit but was never imported anywhere) is removed, and the
`NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription` Info.plist strings are
removed. (Step count via Health Connect exists only in the Android build's dormant
`useStepCount` hook and isn't shown in the UI.)

**Reply:**
> s'up does not read or write HealthKit data. HealthKit linkage and the Health usage strings
> were left over from an unused dependency and have been removed in this build.

---

## 1.4.1 — "external medical hardware"

**Build changes:** the app's copy now avoids clinical/anatomical language throughout, and the
Sources & Methodology page has an "about the s'pots hardware" section stating the sensors are
general-purpose consumer motion sensors, not medical devices.

**Reply:**
> The s'pots are not medical hardware. They are general-purpose consumer motion-sensor modules
> (accelerometer + gyroscope) that report how the sensor is tilted. s'up is a general
> wellness / posture-awareness app: it does not diagnose, treat, cure, or prevent any condition,
> makes no medical claims, and doesn't provide medical services (see Settings → Sources &
> Methodology → "general wellness disclaimer" and "about the s'pots hardware"). No regulatory
> clearance applies, so no region restriction or jurisdiction statement is needed.

*(Confirm the sensor module's datasheet/marketing also doesn't claim medical use before sending.)*

---

## 1.4.1 — citations for "time to move"

**Build changes:** the "time to move" pop-up (and the posture intervention pop-up) now has a
tappable "sources" row that lists and opens its citations in an in-app browser, and Settings →
Sources & Methodology has a new "movement & breaks — cited evidence" section. Citations
(all verified links) live in `src/lib/citations.ts`:

- Waongenngarm P, van der Beek AJ, Akkarakittichoke N, Janwantanakul P. *Effects of an active
  break and postural shift intervention on preventing neck and low-back pain among high-risk
  office workers: a 3-arm cluster-randomized controlled trial.* Scand J Work Environ Health,
  2021;47:306-317. https://pubmed.ncbi.nlm.nih.gov/33906239/
- Waongenngarm P, Areerak K, Janwantanakul P. *The effects of breaks on low back pain,
  discomfort, and work productivity in office workers: A systematic review of randomized and
  non-randomized controlled trials.* Appl Ergon, 2018;68:230-239.
  https://pubmed.ncbi.nlm.nih.gov/29409639/ (note: concludes evidence on low back pain is
  conflicting and evidence on discomfort is low-quality — hence the app's "comfortable" wording)
- Bull FC, Al-Ansari SS, Biddle S, et al. *World Health Organization 2020 guidelines on physical
  activity and sedentary behaviour.* Br J Sports Med, 2020;54(24):1451-1462.
  https://pubmed.ncbi.nlm.nih.gov/33239350/

**Reply:**
> The "time to move" reminder reflects research on short active breaks (walking/stretching)
> and posture changes during long desk sitting, and public-health guidance to limit
> uninterrupted sitting. The app frames this as staying comfortable, not preventing or treating
> pain, since the evidence for back pain specifically is mixed. Citations are now shown directly in the pop-up
> ("sources") and on the Sources & Methodology page (Settings → Sources & Methodology →
> "movement & breaks — cited evidence").
