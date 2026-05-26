import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/src/lib/supabase";
import { autoDetectAndSaveTimezone } from "@/src/services/user/timezoneService";
import { createDefaultBehaviorProfile } from "@/src/services/user/behaviorProfileService";

interface AuthContextType {
  isAuthenticated: boolean;
  loading: boolean;
  userId: string | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (
    email: string,
    password: string,
    name?: string
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Listen for auth state changes so UI stays in sync
  useEffect(() => {
    let mounted = true;
    async function checkAuth() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!mounted) return;
        setIsAuthenticated(!!user);
        setUserId(user?.id ?? null);
      } catch (err) {
        if (!mounted) return;
        setIsAuthenticated(false);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }
    checkAuth();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session?.user);
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      listener?.subscription.unsubscribe();
    };
  }, []);

  async function login(
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.signInWithPassword({ email, password });

      if (error || !user) {
        const msg = error?.message || "Sign in failed";
        console.warn("[auth] signIn failed", error);
        return { success: false, error: msg };
      }

      // Save timezone and mark authenticated
      await autoDetectAndSaveTimezone(user.id);
      setUserId(user.id);
      setIsAuthenticated(true);
      return { success: true };
    } catch (err) {
      console.error("[auth] login error", err);
      return { success: false, error: String(err) };
    }
  }

  async function register(
    email: string,
    password: string,
    name?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.signUp({ email, password });

      if (error) {
        console.warn("[auth] signUp failed", error);
        return { success: false, error: error.message };
      }

      if (!user) {
        return { success: false, error: "No user returned from signUp" };
      }

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
  }

  async function logout(): Promise<void> {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("[auth] signOut failed", err);
    } finally {
      setIsAuthenticated(false);
      setUserId(null);
    }
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, loading, userId, login, register, logout }}>
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
