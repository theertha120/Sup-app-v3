export type DeskPostureState =
  | "upright"
  | "forward_lean"
  | "slouched"
  | "tilted_left"
  | "tilted_right";

export interface DeskPostureSnapshot {
  timestamp: number; // ms from session start
  state: DeskPostureState;
  score: number; // 0–100
  label: string;
  description: string;
}

// Posture config for each state – angles in degrees used by the animation
export const POSTURE_ANGLES: Record<
  DeskPostureState,
  { torso: number; head: number; shoulder: number }
> = {
  upright:      { torso: 0,   head: 0,   shoulder: 0  },
  forward_lean: { torso: 25,  head: 15,  shoulder: 10 },
  slouched:     { torso: 35,  head: 20,  shoulder: 0  },
  tilted_left:  { torso: -15, head: -8,  shoulder: -12 },
  tilted_right: { torso: 15,  head: 8,   shoulder: 12 },
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

// Mock session – cycles every 4 s when played back in the UI
export const MOCK_DESK_POSTURE_SEQUENCE: DeskPostureSnapshot[] = [
  {
    timestamp: 0,
    state: "upright",
    score: 93,
    label: "Perfect Posture",
    description: "Spine aligned, head level above shoulders.",
  },
  {
    timestamp: 4000,
    state: "forward_lean",
    score: 55,
    label: "Forward Lean",
    description: "Head and shoulders pushed forward. Move back!",
  },
  {
    timestamp: 8000,
    state: "slouched",
    score: 32,
    label: "Slouching",
    description: "Back curved and rounded. Sit up straight.",
  },
  {
    timestamp: 12000,
    state: "upright",
    score: 88,
    label: "Good Posture",
    description: "Solid recovery – keep it up!",
  },
  {
    timestamp: 16000,
    state: "tilted_left",
    score: 60,
    label: "Leaning Left",
    description: "Weight shifted to left side. Even out.",
  },
  {
    timestamp: 20000,
    state: "tilted_right",
    score: 63,
    label: "Leaning Right",
    description: "Weight shifted to right side. Even out.",
  },
  {
    timestamp: 24000,
    state: "upright",
    score: 95,
    label: "Excellent!",
    description: "Perfect alignment maintained.",
  },
];
