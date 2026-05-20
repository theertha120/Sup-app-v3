export type DeskPostureState =
  | "upright"
  | "forward_lean"
  | "slouched"
  | "tilted_left"
  | "tilted_right";

// Posture config for each state – angles in degrees used by the animation.
// torso    → side-view panel: forward(+) / back(-) lean
// shoulder → front-view panel: right(+) / left(-) tilt
// head     → head tilt, applied in both views
export const POSTURE_ANGLES: Record<
  DeskPostureState,
  { torso: number; head: number; shoulder: number }
> = {
  upright:      { torso: 0,   head: 0,   shoulder: 0   },
  forward_lean: { torso: 22,  head: 13,  shoulder: 0   },
  slouched:     { torso: 34,  head: 22,  shoulder: 0   },
  tilted_left:  { torso: 0,   head: -8,  shoulder: -22 },
  tilted_right: { torso: 0,   head: 8,   shoulder: 22  },
};

// Score thresholds
export function getScoreColor(score: number): string {
  if (score >= 80) return "#4CAF50"; // green
  if (score >= 55) return "#FF9800"; // amber
  return "#F44336";                  // red
}

export function getScoreLabel(score: number): string {
  if (score >= 80) return "Great";
  if (score >= 55) return "Fair";
  return "Poor";
}
