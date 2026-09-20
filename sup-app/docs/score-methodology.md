# s'up s'core — scoring methodology

Reference documentation for the daily "s'up s'core" shown in the app and everything that feeds
into it. Written for App Store review (Guideline 2.1 information request) and as the source
content for an in-app "how this is calculated" / citations page (Guideline 1.4.1). Every formula
below is copied from, or directly traceable to, the current codebase — nothing here is
aspirational or simplified for the reader; if a number looks odd, it's because that's what
actually runs.

---

## 1. One-paragraph summary (for the App Review reply)

s'up estimates a user's sitting posture using two small wearable motion sensors ("s'pots") worn
on the upper and lower back, and turns that into a daily 0–100 "s'up s'core." The score has three
parts: **quality** (up to 50 points, based on how upright the user's posture was, averaged across
the day's tracked sessions), **showing up** (up to 30 points, for tracking any time at all and a
bonus for longer sessions), and **streak** (up to 20 points, for consecutive days of use). None of
this is a medical diagnosis — it's a self-tracking wellness metric, comparable to a step count
or an activity ring, built on published ergonomics/biomechanics research about seated posture over
time (citations in §6).

---

## 2. The three components

```
sup_score = round(quality + showing_up + streak_pts)          // 0–100
```

### 2a. Quality — up to 50 points

```
quality = (avgShs / 100) * 50
```

`avgShs` is the user's **posture quality score** (internal variable name `shs`, for historical
reasons — see the terminology note in §8), averaged across the day — see §3 for how it's computed.
Concretely: if the user's posture was flawless all day, the score ≈ 100 and quality = 50 points;
if posture was consistently poor, the score trends toward 0 and quality trends toward 0 points.

`avgShs` for a day is a **duration-weighted average** across every tracked session that day (a
20-minute session counts for more than a 2-minute one):

```
avgShs = Σ(session.avg_shs × session.duration_ms) / Σ(session.duration_ms)
```

### 2b. Showing up — up to 30 points

Rewards using the app/hardware at all that day, plus a graduated bonus for longer tracked time:

```
if total tracked time == 0:        0 pts
else:                               15 pts (base, for any tracked time)
  + 5  more pts if total tracked time >= 30 minutes   (20 total)
  + 10 more pts if total tracked time >= 60 minutes   (25 total)
  + 15 more pts if total tracked time >= 120 minutes  (30 total, cap)
```

(The bonus tiers aren't additive on top of each other — it's whichever single tier the user's
total tracked time for the day qualifies for: 15 / 20 / 25 / 30.)

### 2c. Streak — up to 20 points

```
streak_pts = min(20, streak_days * 3)
```

So the streak component maxes out at a 7-day streak (7 × 3 = 21, capped to 20) and grows by 3
points per consecutive day before that. A streak day is defined by the device's local calendar
day (not UTC): using the app again on the very next calendar day extends the streak by one;
skipping a day resets it to 1 on the next session.

---

## 3. Posture quality score — the number behind "quality"

The posture quality score is a **real-time, per-session** score from 0–100 (starts at 100 each
session), computed entirely from the two wearable IMU (inertial measurement unit) sensors — no
camera, no separate health inputs, no data from outside the s'pot hardware.

### 3a. Hardware and placement
- **Top s'pot** — worn on the upper back, between the shoulder blades.
- **Bottom s'pot** — worn on the lower back, just above the waistband.
- Each contains a 6-axis IMU (accelerometer + gyroscope) that reports orientation angles (roll,
  pitch, yaw) over Bluetooth LE, roughly 10 times per second.

### 3b. One-time calibration
Before tracking starts, the user completes a 5-step calibration: sit in their own natural upright
position (this becomes their personal zero-reference, since people's natural posture varies and
the sensors' physical mounting angle can vary too), then lean forward, backward, right, and left
to their comfortable limit. Calibration's job is **orientation, not thresholds**: the forward and
right lean steps tell the app which raw sensor-angle sign means "forward" and "right" for this
particular physical s'pot mount (a kit can be worn in either of two rotations — calibration
works out which one this is, rather than assuming one fixed mounting orientation for every kit). An
earlier version of this app also rescaled the classification bands themselves to each user's
calibrated comfortable range; that made classification too sensitive in practice and was reverted
— the bands below are fixed for every user once orientation is correctly resolved.

### 3c. Posture classification
On every sensor reading, the app computes two calibration-corrected, orientation-corrected angles:
- **pitchDiff** — the forward/backward angle between the two sensors (positive = leaning forward)
- **rollDiff** — the left/right angle between the two sensors (positive = leaning right)

These are compared against fixed thresholds — the same for every user — to classify the moment
into one of seven states:

| pitchDiff (forward lean)   | State          |
|-----------------------------|----------------|
| 0° to 12° (or any backward) | upright        |
| 12° to 18°                  | transition     |
| 18° to 28°                  | forward_lean   |
| 28° to 42°                  | slouched       |
| > 42°                       | severe         |

Independently, if the sideways angle exceeds 8° and is the dominant signal, the state is
`tilted_left`/`tilted_right` instead (moderate severity past 16°).

Backward lean (negative pitchDiff) is always classified as upright regardless of magnitude —
seated backward extension is generally benign and self-limiting (a chair backrest naturally
prevents extreme range), so it doesn't get penalised the way forward flexion does.

### 3d. Score accumulation (runs once per second)
Every second, the app looks at the current state and adjusts the score:

| State          | Rate (points/second) | Grace period before penalty applies |
|-----------------|----------------------|--------------------------------------|
| upright         | **+0.033**           | none — starts recovering immediately |
| transition      | 0 (no change)        | —                                     |
| forward_lean    | 0 (no change)        | —                                     |
| tilted_left/right| **−0.020**          | 2 minutes                            |
| slouched        | **−0.033**           | 3 minutes                            |
| severe          | **−0.067**           | none — penalised immediately          |

The score is clamped to the 0–100 range after every update. The "grace period" means a brief slip
into `slouched` or a lateral tilt doesn't cost anything until it's been sustained for that long —
short, incidental posture shifts aren't penalised, only sustained ones.

The recovery rate (upright, +0.033/s) is deliberately much slower than the loading rates — about
half the rate of `slouched`'s penalty and roughly a third of `severe`'s. This asymmetry is
intentional: it reflects published research on how sustained posture affects the body over time,
where holding a poor posture builds up strain faster than a brief correction can undo it, so the
score doesn't let a user "erase" ten minutes of slouching with ten seconds of sitting up straight.

A session's `avg_shs` (used in §2a) is the mean of every per-second score value recorded during
that session.

---

## 4. A related, separate number: s'train (branded UI name for CPL — not part of the score)

The app also tracks **Cumulative Postural Load (CPL)**, shown to users under the brand name
**s'train** (Desk Mode's "cumulative s'train" bar, with a "?" button opening the definition
below) — it is **not** part of `sup_score`. It uses the same posture states with its own weights
and a similar slow-recovery design, for the same reasons as §3d, and also decides when to show
the user an in-app reminder pop-up. Mentioned here so it isn't confused with the posture quality
score in §3.

The required definition, used verbatim everywhere s'train is explained in-app:

> **What is s'train?** s'train is s'up's proprietary posture-awareness indicator. It reflects the
> duration and degree of posture deviation tracked relative to your personal calibrated range.
> It does not track physical force, tissue strain, injury, pain, or a medical condition.

Live implementation: `src/components/ui/InfoModal.tsx` (shared "?" popup used by both s'train and
the s'napshot/s'core popups), `app/(tabs)/desk.tsx` (the s'train bar itself), and
`app/sources-methodology.tsx` (the full page every popup links out to).

---

## 5. A second, separate number: `avg_score`

The app separately stores `avg_score` (shown on the stats/history screens as "daily/weekly/monthly
avg"), which is simply the percentage of tracked time spent in the `upright` state:

```
avg_score = (upright_time_ms / total_tracked_time_ms) * 100
```

This is a much simpler metric than the posture quality score/`sup_score` and does not feed into
`sup_score` — it's shown separately as a plain "percent of time you were upright" figure. Flagged
here so it isn't mistaken for the same thing as the "quality" component in §2a.

---

## 6. Scientific basis

Verified, working HTTPS citations — live in `app/sources-methodology.tsx`, tappable there via an
in-app browser (`expo-web-browser`'s `openBrowserAsync`, i.e. SFSafariViewController on iOS).
These replace the earlier code-comment-derived list (Cho et al., Nachemson, Solomonow et al.,
McGill & Solomonow, Tanoue et al.) with a smaller, directly-verified set. Titles below are quoted
verbatim from the published papers — some use the authors' own anatomical terms (e.g. "spinal,"
"lumbar"), which is expected for citing real biomechanics literature and is left unaltered rather
than paraphrased; this is distinct from the app's own copy (§3, §7, and the live UI), which is
kept to plain posture language throughout.

**Wearable posture tracking and feedback** (general evidence base for IMU-based posture
feedback):
- Simpson L, Maharaj MM, Mobbs RJ. *The Role of Wearables in Spinal Posture Analysis: A
  Systematic Review.* 2019. https://pmc.ncbi.nlm.nih.gov/articles/PMC6368717/
- Lee R, James C, Edwards S, et al. *Evidence for the Effectiveness of Feedback from Wearable
  Inertial Sensors during Work-Related Activities: A Scoping Review.* Sensors, 2021;21(19):6377.
  https://doi.org/10.3390/s21196377
- Figueira V, et al. *Wearables for Monitoring and Postural Feedback in the Work Environment: A
  Scoping Review.* Sensors, 2024;24(4):1341. https://pubmed.ncbi.nlm.nih.gov/38400498/

**Sustained posture & s'train** (the accumulate-fast/recover-slow design behind s'train and the
posture quality score's recovery-rate asymmetry in §3d):
- Kang SH, Mirka GA. *Creep Deformation of Viscoelastic Lumbar Tissue During Sustained
  Submaximal Trunk Flexion Postures.* Journal of Biomechanics, 2023;155:111647.
  https://pubmed.ncbi.nlm.nih.gov/37245386/
- Kang SH, Mirka GA. *Cumulative Creep Response of Viscoelastic Lumbar Tissue as a Function of
  Work-Rest Schedule.* Journal of Electromyography and Kinesiology, 2024;78:102916.
  https://pubmed.ncbi.nlm.nih.gov/38909410/

**Movement & breaks** (the "time to move" reminder — short active breaks and posture changes
during long desk sitting; also linked from the pop-up itself):
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

---

## 7. What this app does not claim

For clarity in the App Review response: s'up does not diagnose any medical condition, does not
claim to treat or prevent injury, and does not represent the posture quality score/`sup_score` as
a clinical measurement of any kind. It is a posture-awareness and habit-tracking tool; the
biomechanics literature in §6 explains the *reasoning* behind the scoring design, not a validated
clinical claim.

---

## 8. Terminology cleanup

The internal variable/engine name for the posture quality score is `shs` (`SHS_RATES`,
`avg_shs`, `classifySpinePosture()`, etc.) — a holdover from this feature's original working name.
As of the `main-apple` branch, **every user-facing and App-Review-facing mention** of "spine,"
"spinal," "Spine Health Score," or anatomical terms (disc, ligament, vertebra, lumbar, erector
spinae, facet joint) has been reworded to plain posture language throughout the app's UI
(`app/(tabs)/desk.tsx`'s posture labels/cues, `src/lib/imuParser.ts`'s intervention messages,
`app/sources-methodology.tsx`, onboarding), this document, and other reference docs — this is a
general-wellness posture-awareness app, not a medical device, and its copy shouldn't read like
one. The internal code identifiers listed above were deliberately left unchanged (renaming
`classifySpinePosture`/`shs`/etc. throughout the codebase is a separate, much larger and riskier
refactor with no App Review benefit, since reviewers see the shipped app, not the source) — only
what a user or a reviewer actually reads was in scope.

Separately, "cumulative spinal load" and its related labels were rebranded to "s'train" per §4
above — that one **is** a new proprietary name, now used consistently in the live Desk Mode UI,
the AI coach's prompt context (`src/services/ai/claudeProvider.ts`), and this document.
