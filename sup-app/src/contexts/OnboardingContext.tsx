import React, { createContext, useContext, useState, ReactNode } from "react";

interface OnboardingAnswers {
  howHeard: string;
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  q5: string;
  q6: string;
}

interface PendingSignup {
  firstName: string;
  lastName: string;
  email: string;
}

interface OnboardingContextType {
  answers: OnboardingAnswers;
  age: number;
  pendingSignup: PendingSignup;
  setHowHeard: (v: string) => void;
  setQ1: (v: string) => void;
  setQ2: (v: string) => void;
  setQ3: (v: string) => void;
  setQ4: (v: string) => void;
  setQ5: (v: string) => void;
  setQ6: (v: string) => void;
  setAge: (v: number) => void;
  setPendingSignup: (v: PendingSignup) => void;
  reset: () => void;
}

const defaultAnswers: OnboardingAnswers = {
  howHeard: "", q1: "", q2: "", q3: "", q4: "", q5: "", q6: "",
};

const defaultPendingSignup: PendingSignup = {
  firstName: "", lastName: "", email: "",
};

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [answers, setAnswers] = useState<OnboardingAnswers>(defaultAnswers);
  const [age, setAge] = useState(27);
  const [pendingSignup, setPendingSignup] = useState<PendingSignup>(defaultPendingSignup);

  const set = (field: keyof OnboardingAnswers) => (v: string) =>
    setAnswers((prev) => ({ ...prev, [field]: v }));

  return (
    <OnboardingContext.Provider value={{
      answers,
      age,
      pendingSignup,
      setHowHeard: set("howHeard"),
      setQ1: set("q1"),
      setQ2: set("q2"),
      setQ3: set("q3"),
      setQ4: set("q4"),
      setQ5: set("q5"),
      setQ6: set("q6"),
      setAge,
      setPendingSignup,
      reset: () => { setAnswers(defaultAnswers); setAge(27); setPendingSignup(defaultPendingSignup); },
    }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}
