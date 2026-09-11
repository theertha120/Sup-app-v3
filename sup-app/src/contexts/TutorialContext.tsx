import React, { createContext, useContext, useState, ReactNode } from "react";

export type TutorialStep =
  | "goals-tip"
  | "data-tip"
  | "snapshot-tip"
  | "settings-tip"
  | "coaching-tip"
  | "calibrate-tip"
  | "connect-tip"
  | "figure-tip"
  | "supdate-tip"
  | "end-session-tip"
  | "stats-tip"
  | "stats-tip-trend"
  | "stats-tip-session"
  | "stats-tip-breakdown"
  | "community-tip"
  | "add-friends-tip"
  | null;

interface TutorialContextType {
  tutorialStep: TutorialStep;
  setTutorialStep: (step: TutorialStep) => void;
  startTutorial: () => void;
  dismissTutorial: () => void;
}

const TutorialContext = createContext<TutorialContextType | undefined>(undefined);

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>(null);

  return (
    <TutorialContext.Provider value={{
      tutorialStep,
      setTutorialStep,
      startTutorial: () => setTutorialStep("goals-tip"),
      dismissTutorial: () => setTutorialStep(null),
    }}>
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error("useTutorial must be used within TutorialProvider");
  return ctx;
}
