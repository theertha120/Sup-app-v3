import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/constants/env";
import { supabase } from "@/src/lib/supabase";
import { checkEmailRegistered as checkEmail, type EmailCheckResult } from "@/src/lib/checkEmail";
import { autoDetectAndSaveTimezone } from "@/src/services/user/timezoneService";
import { checkStreakOnLogin } from "@/src/services/posture/postureSyncService";

interface AuthContextType {
  isAuthenticated: boolean;
  loading: boolean;
  userId: string | null;
  registrationMode: boolean;
  startRegistration: () => void;
  stopRegistration: () => void;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (
    email: string,
    password: string
  ) => Promise<{ success: boolean; error?: string }>;
  verifyEmailOtp: (
    email: string,
    token: string
  ) => Promise<{ success: boolean; error?: string }>;
  resendOtp: (email: string) => Promise<{ success: boolean; error?: string }>;
  checkEmailRegistered: (email: string) => Promise<EmailCheckResult>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyPasswordResetOtp: (
    email: string,
    token: string
  ) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  deleteAccount: () => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [registrationMode, setRegistrationMode] = useState(false);

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
        if (user) await checkStreakOnLogin(user.id);
      } catch {
        if (!mounted) return;
        setIsAuthenticated(false);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }
    checkAuth();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session?.user);
      setUserId(session?.user?.id ?? null);
      if (session?.user) {
        setRegistrationMode(false);
        if (event === "SIGNED_IN") checkStreakOnLogin(session.user.id);
      }
    });

    return () => {
      mounted = false;
      listener?.subscription.unsubscribe();
    };
  }, []);

  function startRegistration() {
    setRegistrationMode(true);
  }

  function stopRegistration() {
    setRegistrationMode(false);
  }

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
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });

      if (error) {
        console.warn("[auth] signUp failed", error);
        return { success: false, error: error.message };
      }

      if (!data.user) {
        return { success: false, error: "No user returned from signUp" };
      }

      // Email confirmation is required, so no session exists yet — the caller
      // must send the user through verifyEmailOtp before they're signed in.
      // Profile rows are created after verification, once a session exists.
      return { success: true };
    } catch (err) {
      console.error("[auth] register error", err);
      return { success: false, error: String(err) };
    }
  }

  async function verifyEmailOtp(
    email: string,
    token: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "signup",
      });

      if (error || !data.user) {
        const msg = error?.message || "Invalid or expired code";
        console.warn("[auth] verifyEmailOtp failed", error);
        return { success: false, error: msg };
      }

      await autoDetectAndSaveTimezone(data.user.id);

      setUserId(data.user.id);
      setIsAuthenticated(true);
      return { success: true };
    } catch (err) {
      console.error("[auth] verifyEmailOtp error", err);
      return { success: false, error: String(err) };
    }
  }

  async function resendOtp(
    email: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) {
        console.warn("[auth] resendOtp failed", error);
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err) {
      console.error("[auth] resendOtp error", err);
      return { success: false, error: String(err) };
    }
  }

  async function checkEmailRegistered(
    email: string
  ): Promise<EmailCheckResult> {
    return checkEmail(email, (name, options) => supabase.functions.invoke(name, options));
  }

  async function requestPasswordReset(
    email: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) {
        console.warn("[auth] requestPasswordReset failed", error);
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err) {
      console.error("[auth] requestPasswordReset error", err);
      return { success: false, error: String(err) };
    }
  }

  async function verifyPasswordResetOtp(
    email: string,
    token: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "recovery",
      });

      if (error || !data.user) {
        const msg = error?.message || "Invalid or expired code";
        console.warn("[auth] verifyPasswordResetOtp failed", error);
        return { success: false, error: msg };
      }

      setUserId(data.user.id);
      setIsAuthenticated(true);
      return { success: true };
    } catch (err) {
      console.error("[auth] verifyPasswordResetOtp error", err);
      return { success: false, error: String(err) };
    }
  }

  async function updatePassword(
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        console.warn("[auth] updatePassword failed", error);
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err) {
      console.error("[auth] updatePassword error", err);
      return { success: false, error: String(err) };
    }
  }

  async function clearLocalAppData(): Promise<void> {
    try {
      await AsyncStorage.clear();
    } catch (err) {
      console.warn("[auth] Failed to clear local app data", err);
    }
  }

  async function deleteAccount(): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        return { success: false, error: "Missing Supabase app configuration" };
      }

      if (!accessToken) {
        return { success: false, error: "You must be signed in to delete your account" };
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
      });

      const responseText = await response.text();
      let payload: { success?: boolean; error?: string } | null = null;

      try {
        payload = responseText ? JSON.parse(responseText) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message = payload?.error || responseText || `Delete failed with status ${response.status}`;
        console.warn("[auth] delete-account function failed", response.status, message);
        return { success: false, error: message };
      }

      if (!payload?.success) {
        return { success: false, error: payload?.error ?? "Failed to delete account" };
      }

      await clearLocalAppData();

      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        console.warn("[auth] signOut after delete failed", signOutError);
      }

      setIsAuthenticated(false);
      setUserId(null);
      setRegistrationMode(false);
      return { success: true };
    } catch (err) {
      console.error("[auth] deleteAccount error", err);
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
    <AuthContext.Provider value={{ isAuthenticated, loading, userId, registrationMode, startRegistration, stopRegistration, login, register, verifyEmailOtp, resendOtp, checkEmailRegistered, requestPasswordReset, verifyPasswordResetOtp, updatePassword, deleteAccount, logout }}>
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
