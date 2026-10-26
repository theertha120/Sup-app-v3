import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAuth } from "./AuthContext";

export type TutorialStep =
  | "goals-tip"
  | "data-tip"
  | "snapshot-tip"
  | "snapshot-tip-stats"
  | "settings-tip"
  | "coaching-tip"
  | "calibrate-tip"
  | "connect-tip"
  | "figure-tip"
  | "supdate-tip"
  | "end-session-tip"
  | "stats-tip"
  | "community-tip"
  | "add-friends-tip"
  | "header-settings-tip"
  | "header-sensor-tip"
  | "header-streak-tip"
  // "Go to" prompts between pages: the user opens the next page themselves
  // (navbar tab or header icon) so they learn how to get there; tapping the
  // highlighted target starts that page's tips.
  | "go-home-tip"
  | "go-daily-tip"
  | "go-settings-tip"
  | "go-sensor-tip"
  | "go-desk-tip"
  | "go-stats-tip"
  | "go-community-tip"
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
  const { userId } = useAuth();

  // End any tutorial in progress on logout or account switch, so its tips
  // don't stay on the logged-out screens or carry over to the next account.
  useEffect(() => {
    setTutorialStep(null);
  }, [userId]);

  return (
    <TutorialContext.Provider value={{
      tutorialStep,
      setTutorialStep,
      startTutorial: () => setTutorialStep("go-home-tip"),
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
