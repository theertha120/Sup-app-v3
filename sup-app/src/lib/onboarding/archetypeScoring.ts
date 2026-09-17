export type Archetype = "Compiler" | "Autonomist" | "Strategist" | "Ritualist";
export type Chronotype = "Lark" | "Owl";
export type Interoception = "Sensor-Driven" | "Reflective";
export type Elasticity = "Low" | "High" | "Fluid" | "Friction Averse";

export interface OnboardingResult {
  archetype: Archetype;
  chronotype: Chronotype;
  interoception: Interoception;
  elasticity: Elasticity;
}

const Q1_MAP: Record<string, Archetype> = {
  A: "Strategist", B: "Compiler", C: "Autonomist", D: "Ritualist",
};

const Q2_MAP: Record<string, Archetype> = {
  A: "Ritualist", B: "Compiler", C: "Strategist", D: "Autonomist",
};

const Q3_ELASTICITY_MAP: Record<string, Elasticity> = {
  A: "Low", B: "High", C: "Fluid", D: "Friction Averse",
};

const Q3_TIEBREAK_MAP: Record<string, Archetype | null> = {
  A: "Ritualist", B: "Compiler", C: "Autonomist", D: null,
};

export function computeOnboardingResult(
  q1: string, q2: string, q3: string, q4: string, q5: string, q6: string,
): OnboardingResult {
  // --- Archetype scoring ---
  const scores: Record<Archetype, number> = {
    Compiler: 0, Autonomist: 0, Strategist: 0, Ritualist: 0,
  };

  // Core signal: Q1 + Q2 (1 point each)
  if (Q1_MAP[q1]) scores[Q1_MAP[q1]] += 1;
  if (Q2_MAP[q2]) scores[Q2_MAP[q2]] += 1;

  // Leaked signal bonus fractions (Compiler only)
  if (q5 === "A") scores.Compiler += 0.5;
  if (q6 === "C") scores.Compiler += 0.5;

  const maxScore = Math.max(...Object.values(scores));
  const tied = (Object.keys(scores) as Archetype[]).filter((a) => scores[a] === maxScore);

  let archetype: Archetype;
  if (tied.length === 1) {
    archetype = tied[0];
  } else if (tied.includes("Compiler")) {
    // Compiler bonus fractions already baked in — if it's still tied, Compiler wins
    archetype = "Compiler";
  } else {
    // Q3 tiebreak
    const q3Arch = Q3_TIEBREAK_MAP[q3];
    if (q3Arch && tied.includes(q3Arch)) {
      archetype = q3Arch;
    } else if (q3 === "D") {
      // Q3=D: fall back to Q1's gut-reaction answer
      const q1Arch = Q1_MAP[q1];
      archetype = q1Arch && tied.includes(q1Arch) ? q1Arch : "Compiler";
    } else {
      // Final default: statistically most common
      archetype = "Compiler";
    }
  }

  // --- Chronotype (Q4) ---
  const chronotype: Chronotype = q4 === "A" ? "Lark" : "Owl";

  // --- Interoception (Q5) ---
  const interoception: Interoception = q5 === "A" ? "Sensor-Driven" : "Reflective";

  // --- Elasticity (Q3 base, Q6 refines) ---
  let elasticity: Elasticity = Q3_ELASTICITY_MAP[q3] ?? "High";
  if (q6 === "A") {
    if (elasticity === "High" || elasticity === "Fluid") elasticity = "Low";
  } else if (q6 === "B") {
    if (elasticity === "Low") elasticity = "High";
  } else if (q6 === "C") {
    if (elasticity === "High") elasticity = "Fluid";
    else if (elasticity === "Fluid") elasticity = "Low";
  }
  // Q6=D or unset: keep Q3 base

  return { archetype, chronotype, interoception, elasticity };
}

export interface ArchetypeDisplay {
  label: string;
  description: string;
  quote: string;
}

export const ARCHETYPE_DISPLAY: Record<Archetype, ArchetypeDisplay> = {
  Compiler: {
    label: "the s'oldier",
    description: "you can lock in for hours, but your body pays the price",
    quote: '"i\'ll take a break later..."',
  },
  Autonomist: {
    label: "the s'oloist",
    description: "you move on your own terms - your posture didn't get the memo",
    quote: '"i\'ll do it when it feels right"',
  },
  Strategist: {
    label: "the s'trategist",
    description: "you plan everything - now add your posture to the system",
    quote: '"if it\'s not in the plan, it won\'t happen"',
  },
  Ritualist: {
    label: "the s'cheduler",
    description: "your habits run your life - time to add this one to the stack",
    quote: '"same time, every day, no excuses"',
  },
};
