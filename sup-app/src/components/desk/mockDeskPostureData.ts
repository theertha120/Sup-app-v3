/**
 * mockDeskPostureData.ts
 *
 * UI helpers for the Desk Mode posture figure and score display.
 * State list updated to include hip_hinge and transition states
 * from the new biomechanical classification model.
 *
 * s'up brand: all UI strings lowercase, "s'pot" not "sensor".
 */

export type DeskPostureState =
  | "upright"
  | "transition"     // early flexion zone — watch and wait, no alert
  | "forward_lean"   // true lumbar flexion beginning — upper back rounding relative to pelvis
  | "slouched"       // significant lumbar flexion — disc compression zone
  | "severe"         // >35° relative flexion — passive ligament loading zone
  | "tilted_left"
  | "tilted_right";

// Posture figure animation angles — used by DeskPostureFigure.tsx
// torso    → side-view: forward(+) / back(-) lean in degrees
// shoulder → front-view: right(+) / left(-) tilt in degrees
// head     → head tilt applied in both views
export const POSTURE_ANGLES: Record<
  DeskPostureState,
  { torso: number; head: number; shoulder: number }
> = {
  upright:      { torso:  0,  head:  0,  shoulder:  0  },
  transition:   { torso: 12,  head:  5,  shoulder:  0  }, // subtle early lean
  forward_lean: { torso: 22,  head: 13,  shoulder:  0  },
  slouched:     { torso: 34,  head: 22,  shoulder:  0  },
  severe:       { torso: 34,  head: 22,  shoulder:  0  }, // same figure as slouched, worse loading
  tilted_left:  { torso:  0,  head: -8,  shoulder: -22 },
  tilted_right: { torso:  0,  head:  8,  shoulder:  22 },
};

// ── Spine Health Score (SHS) colour bands ─────────────────────────────────────
//
// Updated from old PLI bands to reflect the new BIS/SHS model.
// Red is now reserved for genuinely sustained dangerous postures —
// a momentary lean should not turn the figure red.
//
//   80–100  green   — excellent structural alignment
//   60–79   amber   — notice this, small adjustment helpful
//   40–59   orange  — act on this, tissue loading accumulating
//   0–39    red     — urgent, significant structural debt accumulated

export function getScoreColor(score: number): string {
  if (score >= 80) return "#4CAF50"; // green
  if (score >= 60) return "#FF9800"; // amber
  if (score >= 40) return "#FF5722"; // orange
  return "#F44336";                  // red — reserved for sustained bad posture only
}

