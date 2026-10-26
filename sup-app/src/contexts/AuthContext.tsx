import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { AppState, AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/constants/env";
import { supabase } from "@/src/lib/supabase";
import { checkEmailRegistered as checkEmail, type EmailCheckResult } from "@/src/lib/checkEmail";
import { captureError, captureFunctionError } from "@/src/lib/sentry";
import { autoDetectAndSaveTimezone } from "@/src/services/user/timezoneService";
import { checkStreakOnAppOpen } from "@/src/services/posture/postureSyncService";

interface AuthContextType {
  isAuthenticated: boolean;
  userId: string | null;
  streakVersion: number;
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

// Supabase error codes caused by the user's own input or normal limits
// (wrong password/code, once-a-minute resend, …) — not bugs, so they're
// kept out of Sentry.
const EXPECTED_AUTH_ERRORS = new Set([
  "invalid_credentials",
  "otp_expired",
  "over_email_send_rate_limit",
  "over_request_rate_limit",
  "same_password",
  "weak_password",
  "email_not_confirmed",
  "email_address_invalid",
  "user_already_exists",
  "email_exists",
]);

function reportAuthError(error: unknown, context: string) {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && EXPECTED_AUTH_ERRORS.has(code)) return;
  captureError(error, context);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [registrationMode, setRegistrationMode] = useState(false);
  // Bumped after each streak check so streak displays (HeaderBar) can refetch.
  const [streakVersion, setStreakVersion] = useState(0);
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = userId;

  async function runStreakCheck(uid: string) {
    await checkStreakOnAppOpen(uid);
    setStreakVersion((v) => v + 1);
  }

  // Re-check the streak each time the app returns from the background.
  useEffect(() => {
    let wasBackgrounded = false;
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "background") {
        wasBackgrounded = true;
      } else if (nextState === "active" && wasBackgrounded) {
        wasBackgrounded = false;
        if (userIdRef.current) runStreakCheck(userIdRef.current);
      }
    });
    return () => sub.remove();
  }, []);

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
        if (user) await runStreakCheck(user.id);
      } catch (err) {
        captureError(err, "auth-startup");
        if (!mounted) return;
        setIsAuthenticated(false);
      }
    }
    checkAuth();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session?.user);
      setUserId(session?.user?.id ?? null);
      if (session?.user) {
        setRegistrationMode(false);
        if (event === "SIGNED_IN") runStreakCheck(session.user.id);
      }
    });

    return () => {
      mounted = false;
      listener?.subscription.unsubscribe();
    };
  }, []);

  // Keep user_profile.timezone_offset_minutes current. Nothing reads it right
  // now — generate-daily-summaries runs at a fixed 8am Singapore time — but it
  // is kept so the daily insight can later move to each user's own 8am (the
  // commented-out handler there already does this). Saved on launch and
  // whenever the app returns to the foreground (not just at login), so it
  // follows users who travel or cross a daylight-saving change.
  useEffect(() => {
    if (!userId) return;
    autoDetectAndSaveTimezone(userId);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") autoDetectAndSaveTimezone(userId);
    });
    return () => sub.remove();
  }, [userId]);

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
        if (error) reportAuthError(error, "login");
        return { success: false, error: msg };
      }
      return { success: true };
    } catch (err) {
      console.error("[auth] login error", err);
      captureError(err, "login");
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
        reportAuthError(error, "register");
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
      captureError(err, "register");
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
        if (error) reportAuthError(error, "verify-email-otp");
        return { success: false, error: msg };
      }
      return { success: true };
    } catch (err) {
      console.error("[auth] verifyEmailOtp error", err);
      captureError(err, "verify-email-otp");
      return { success: false, error: String(err) };
    }
  }

  async function checkEmailRegistered(
  email: string
): Promise<EmailCheckResult> {
  const result = await checkEmail(
    email,
    (name, options) => supabase.functions.invoke(name, options)
  );

  if (!result.success) {
    captureError(new Error(result.error), "check-email");
  }

  return result;
}

  async function requestPasswordReset(
    email: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) {
        console.warn("[auth] requestPasswordReset failed", error);
        reportAuthError(error, "password-reset-request");
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err) {
      console.error("[auth] requestPasswordReset error", err);
      captureError(err, "password-reset-request");
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
        if (error) reportAuthError(error, "password-reset-verify");
        return { success: false, error: msg };
      }
      return { success: true };
    } catch (err) {
      console.error("[auth] verifyPasswordResetOtp error", err);
      captureError(err, "password-reset-verify");
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
        reportAuthError(error, "password-update");
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err) {
      console.error("[auth] updatePassword error", err);
      captureError(err, "password-update");
      return { success: false, error: String(err) };
    }
  }

  async function clearLocalAppData(): Promise<void> {
    try {
      await AsyncStorage.clear();
    } catch (err) {
      console.warn("[auth] Failed to clear local app data", err);
      captureError(err, "clear-local-data");
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
        void captureFunctionError("delete-account", new Error(`delete-account failed with status ${response.status}`), {
          status: response.status,
          body: responseText,
        });
        return { success: false, error: message };
      }

      if (!payload?.success) {
        return { success: false, error: payload?.error ?? "Failed to delete account" };
      }

      await clearLocalAppData();

      try {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          console.warn("[auth] signOut after delete failed", signOutError);
          captureError(signOutError, "delete-account-signout");
        }
      } catch (signOutError) {
        console.warn("[auth] signOut after delete failed", signOutError);
        captureError(signOutError, "delete-account-signout");
      }

      setIsAuthenticated(false);
      setUserId(null);
      setRegistrationMode(false);
      return { success: true };
    } catch (err) {
      console.error("[auth] deleteAccount error", err);
      captureError(err, "delete-account");
      return { success: false, error: String(err) };
    }
  }

  async function logout(): Promise<void> {
    try {
      // signOut usually reports failure in `error` rather than throwing.
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.warn("[auth] signOut failed", error);
        captureError(error, "logout");
      }
    } catch (err) {
      console.warn("[auth] signOut failed", err);
      captureError(err, "logout");
    } finally {
      setIsAuthenticated(false);
      setUserId(null);
    }
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, userId, streakVersion, registrationMode, startRegistration, stopRegistration, login, register, verifyEmailOtp, checkEmailRegistered, requestPasswordReset, verifyPasswordResetOtp, updatePassword, deleteAccount, logout }}>
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
