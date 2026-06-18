import React, { createContext, useContext, useState, ReactNode } from "react";
import { autoDetectAndSaveTimezone } from "@/src/services/user/timezoneService";
import { CURRENT_USER_ID } from "@/constants/env";

interface AuthContextType {
  isAuthenticated: boolean;
  login: (email: string, password: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const login = async (email: string, password: string): Promise<boolean> => {
    // Simple authentication check, later integrate with 'users' list in backend
    if (email === "user@test.com" && password === "1234") {
      setIsAuthenticated(true);

      // Auto-detect and save timezone
      await autoDetectAndSaveTimezone(CURRENT_USER_ID);

      // Try to create profile rows immediately using the returned user id.
      const displayName = name || email.split("@")[0];
      try {
        await supabase.from("profiles").insert({
          id: user.id,
          name: displayName,
          avatar_url: null,
          current_streak: 0,
          weekly_total_points: 0,
        });

        const def = createDefaultBehaviorProfile();
        await supabase.from("user_profile").upsert({
          id: user.id,
          primary_goals: def.primaryGoal,
          preferred_tones: def.preferredTone,
          reminder_frequency: def.reminderFrequency,
          active_time_start: def.activeTimeStart,
          active_time_end: def.activeTimeEnd,
          weekly_goals: def.weeklyGoal,
        });
      } catch (e) {
        console.warn("[auth] failed to create profile rows after signUp", e);
      }

      // After sign-up, attempt to sign in immediately to establish a session.
      const signIn = await supabase.auth.signInWithPassword({ email, password });

      if (signIn.error || !signIn.data?.user) {
        // Sign-in failed (likely due to email confirmation). Return success=false but inform user,
        // profiles were created and user can confirm email to sign in.
        const errMsg = signIn.error?.message || "Please confirm your email before signing in.";
        console.warn("[auth] post-signup signIn failed", signIn.error);
        return { success: false, error: errMsg };
      }

      const signedInUser = signIn.data.user;

      // After successful sign-in, auto-detect timezone
      await autoDetectAndSaveTimezone(signedInUser.id);

      setUserId(signedInUser.id);
      setIsAuthenticated(true);
      return { success: true };
    } catch (err) {
      console.error("[auth] register error", err);
      return { success: false, error: String(err) };
    }
    return false;
  };

  const logout = () => {
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
