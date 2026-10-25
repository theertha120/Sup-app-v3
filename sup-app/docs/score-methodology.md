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
on the upper and lower back, and turns that into a daily 0–100 "s'up s'core." Every tracked minute
earns posture credit (100 for upright down to 0 for severe slouching), and the s'core is the
time-weighted average of that credit, blended with a fixed starting point of 50 so that very short
sessions can't produce extreme scores. None of this is a medical diagnosis — it's a self-monitoring wellness metric, comparable to a step count
or an activity ring, built on published ergonomics/biomechanics research about seated posture and
spinal loading (citations in §6).

---

## 2. The formula

Every tracked minute earns **posture credit** based on its posture classification (see §3c):

| State                 | Credit |
|-----------------------|--------|
| upright               | 100    |
| transition            | 75     |
| forward_lean          | 50     |
| tilted_left / right   | 50     |
| slouched              | 25     |
| severe                | 0      |

The daily score is the time-weighted average of that credit across all of the day's tracked time,
blended with a fixed **prior** of 10 minutes at a score of 50:

```
sup_score = round( (Σ(time_in_state × credit) + 50 × 10 min)
                   / (total_tracked_time + 10 min) )                 // 0–100
```

The prior keeps very short sessions from producing extreme scores. A day starts at 50 and moves
towards the user's real posture as tracked time grows: after 10 minutes the user's own posture
carries half the weight, after an hour about 86%, after two hours about 92%.

| Tracked day                    | s'core |
|--------------------------------|---------|
| 1 min, perfect posture         | 55      |
| 10 min, perfect posture        | 75      |
| 60 min, perfect posture        | 93      |
| 60 min at 75% posture credit   | 71      |
| 1 min, severe posture          | 45      |

The score is always strictly between 0 and 100. A day with no tracked time has no score.

Implementation: `computeSupScore()` in `src/services/posture/postureSyncService.ts`. The inputs
are the per-state time totals summed across every completed session that day.

**Longer periods** (stats week/month/year bars and summaries, leaderboard) use the same formula on
the period's summed per-state time — not a mean of daily scores. Each day therefore counts in
proportion to its tracked time, and the 10-minute prior is applied once per period rather than
once per day. Implementation: `supScoreForRows()` in the same file.

---

## 3. Posture sensing, and the Spine Health Score (SHS)

SHS is a **real-time, per-session** score from 0–100 (starts at 100 each session), computed
entirely from the two wearable IMU (inertial measurement unit) sensors — no camera, no separate
health inputs, no data from outside the s'pot hardware.

### 3a. Hardware and placement
- **Top s'pot** — worn on the upper back, approximately the T4–T6 vertebral region.
- **Bottom s'pot** — worn on the lower back, approximately the L2–L4 vertebral region.
- Each contains a 6-axis IMU (accelerometer + gyroscope) that reports orientation angles (roll,
  pitch, yaw) over Bluetooth LE, roughly 10 times per second.

### 3b. One-time calibration
Before tracking starts, the user completes a 5-step calibration: sit in their own natural upright
position (this becomes their personal zero-reference, since people's natural posture varies and
the sensors' physical mounting angle can vary too), then lean forward, backward, right, and left
to their comfortable limit. Calibration's job is **orientation, not thresholds**: the forward and
right lean steps tell the app which raw sensor-angle sign means "forward" and "right" for this
particular physical s'pot mount (a kit can be worn in either of two rotations — calibration
detects which one this is, rather than assuming one fixed mounting orientation for every kit). An
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

A session's `avg_shs` is the mean of every per-second SHS value recorded during that session. SHS
is shown live in Desk Mode and stored per session/day, but it is **not** an input to `sup_score`
any more — the score in §2 is computed directly from time spent in each posture state.

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

It does not feed into `sup_score` — it's shown separately as a plain "percent of time you were
upright" figure. `sup_score` uses the same time totals but gives partial credit to in-between
states and blends in the 10-minute prior (§2), so the two numbers differ.

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
