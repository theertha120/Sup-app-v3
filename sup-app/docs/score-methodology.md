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
this is a medical diagnosis — it's a self-monitoring wellness metric, comparable to a step count
or an activity ring, built on published ergonomics/biomechanics research about seated posture and
spinal loading (citations in §6).

---

## 2. The three components

```
sup_score = round(quality + showing_up + streak_pts)          // 0–100
```

### 2a. Quality — up to 50 points

```
quality = (avgShs / 100) * 50
```

`avgShs` is the user's **Spine Health Score (SHS)**, averaged across the day — see §3 for how SHS
itself is computed. Concretely: if the user's posture was flawless all day, SHS ≈ 100 and quality
= 50 points; if posture was consistently poor, SHS trends toward 0 and quality trends toward 0
points.

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

## 3. Spine Health Score (SHS) — the number behind "quality"

SHS is a **real-time, per-session** score from 0–100 (starts at 100 each session), computed
entirely from the two wearable IMU (inertial measurement unit) sensors — no camera, no separate
health inputs, no data from outside the s'pot hardware.

### 3a. Hardware and placement
- **Top s'pot** — worn on the upper back, approximately the T4–T6 vertebral region.
- **Bottom s'pot** — worn on the lower back, approximately the L2–L4 vertebral region.
- Each contains a 6-axis IMU (accelerometer + gyroscope) that reports orientation angles (roll,
  pitch, yaw) over Bluetooth LE, roughly 10 times per second.

### 3b. One-time calibration
Before tracking starts, the user completes a short calibration: sit in their own natural upright
position (this becomes their personal zero-reference, since people's natural posture varies and
the sensors' physical mounting angle can vary too), then lean forward, backward, right, and left
to their comfortable limit. This calibration is used only to correct for individual anatomy and
sensor mounting — it does not change the scoring formula itself.

### 3c. Posture classification
On every sensor reading, the app computes two calibration-corrected angles:
- **pitchDiff** — the forward/backward angle between the two sensors (positive = leaning forward)
- **rollDiff** — the left/right angle between the two sensors (positive = leaning right)

These are compared against fixed thresholds to classify the moment into one of seven states:

| pitchDiff (forward lean)   | State          |
|-----------------------------|----------------|
| 0° to 12° (or any backward) | upright        |
| 12° to 18°                  | transition     |
| 18° to 28°                  | forward_lean   |
| 28° to 42°                  | slouched       |
| > 42°                       | severe         |

Independently, if the sideways angle exceeds 8° and is the dominant signal, the state is
`tilted_left` or `tilted_right` instead.

### 3d. SHS accumulation (runs once per second)
Every second, the app looks at the current state and adjusts SHS:

| State          | Rate (points/second) | Grace period before penalty applies |
|-----------------|----------------------|--------------------------------------|
| upright         | **+0.033**           | none — starts recovering immediately |
| transition      | 0 (no change)        | —                                     |
| forward_lean    | 0 (no change)        | —                                     |
| tilted_left/right| **−0.020**          | 2 minutes                            |
| slouched        | **−0.033**           | 3 minutes                            |
| severe          | **−0.067**           | none — penalised immediately          |

SHS is clamped to the 0–100 range after every update. The "grace period" means a brief slip into
`slouched` or a lateral tilt doesn't cost anything until it's been sustained for that long —
short, incidental posture shifts aren't penalised, only sustained ones.

The recovery rate (upright, +0.033/s) is deliberately much slower than the loading rates — about
half the rate of `slouched`'s penalty and roughly a third of `severe`'s. This asymmetry is
intentional: it reflects published research on spinal ligament creep, where sustained poor
posture builds up strain faster than a brief correction can undo it, so the score doesn't let a
user "erase" ten minutes of slouching with ten seconds of sitting up straight.

A session's `avg_shs` (used in §2a) is the mean of every per-second SHS value recorded during that
session.

---

## 4. A related, separate number: s'train (branded UI name for CPL — not part of the score)

The app also tracks **Cumulative Postural Load (CPL)**, shown to users under the brand name
**s'train** (Desk Mode's "cumulative s'train" bar, with a "?" button opening the definition
below) — it is **not** part of `sup_score`. It uses the same posture states with its own weights
and a similar slow-recovery design, for the same biomechanical reasons as §3d, and also decides
when to show the user an in-app reminder pop-up. Mentioned here so it isn't confused with SHS.

The required definition, used verbatim everywhere s'train is explained in-app:

> **What is s'train?** s'train is s'up's proprietary posture-awareness indicator. It reflects the
> duration and degree of posture deviation detected relative to your personal calibrated range.
> It does not measure physical force, tissue strain, injury, pain, or a medical condition.

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

This is a much simpler metric than SHS/`sup_score` and does not feed into `sup_score` — it's
shown separately as a plain "percent of time you were upright" figure. Flagged here so it isn't
mistaken for the same thing as the "quality" component in §2a.

---

## 6. Scientific basis

Verified, working HTTPS citations — live in `app/sources-methodology.tsx`, tappable there via an
in-app browser (`expo-web-browser`'s `openBrowserAsync`, i.e. SFSafariViewController on iOS).
These replace the earlier code-comment-derived list (Cho et al., Nachemson, Solomonow et al.,
McGill & Solomonow, Tanoue et al.) with a smaller, directly-verified set:

**Wearable posture monitoring and feedback** (general evidence base for IMU-based posture
monitoring):
- Simpson L, Maharaj MM, Mobbs RJ. *The Role of Wearables in Spinal Posture Analysis: A
  Systematic Review.* 2019. https://pmc.ncbi.nlm.nih.gov/articles/PMC6368717/
- Lee R, James C, Edwards S, et al. *Evidence for the Effectiveness of Feedback from Wearable
  Inertial Sensors during Work-Related Activities: A Scoping Review.* Sensors, 2021;21(19):6377.
  https://doi.org/10.3390/s21196377
- Figueira V, et al. *Wearables for Monitoring and Postural Feedback in the Work Environment: A
  Scoping Review.* Sensors, 2024;24(4):1341. https://pubmed.ncbi.nlm.nih.gov/38400498/

**Sustained posture & s'train** (the accumulate-fast/recover-slow design behind s'train and the
SHS recovery-rate asymmetry in §3d):
- Kang SH, Mirka GA. *Creep Deformation of Viscoelastic Lumbar Tissue During Sustained
  Submaximal Trunk Flexion Postures.* Journal of Biomechanics, 2023;155:111647.
  https://pubmed.ncbi.nlm.nih.gov/37245386/
- Kang SH, Mirka GA. *Cumulative Creep Response of Viscoelastic Lumbar Tissue as a Function of
  Work-Rest Schedule.* Journal of Electromyography and Kinesiology, 2024;78:102916.
  https://pubmed.ncbi.nlm.nih.gov/38909410/

---

## 7. What this app does not claim

For clarity in the App Review response: s'up does not diagnose any medical condition, does not
claim to treat or prevent injury, and does not represent SHS/`sup_score` as a clinical measurement
of spinal health. It is a posture-awareness and habit-tracking tool; the biomechanics literature
in §6 explains the *reasoning* behind the scoring design, not a validated clinical claim.

---

## 8. Terminology cleanup (adding-citations branch)

The two user-facing mentions of "Spine Health Score" (`app/(tabs)/daily.tsx`'s s'napshot/s'core
info popups — the only two places that exact phrase appeared in the UI) were reworded to plain
language ("average posture quality") rather than renamed to a new proprietary name, to avoid
colliding with the existing "s'core" (daily composite) branding. SHS as an *internal* variable/
engine name is unchanged — only its two UI-facing mentions moved. Separately, "cumulative spinal
load" and its related labels were rebranded to "s'train" per §4 above — that one **is** a new
proprietary name, now used consistently in the live Desk Mode UI, the AI coach's prompt context
(`src/services/ai/claudeProvider.ts`), and this document.
