import PressFeedback from "@/src/components/ui/PressFeedback";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, Text, TextInput } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { supabase } from "@/src/lib/supabase";
import { useAuth } from "@/src/contexts/AuthContext";
import { useOnboarding } from "@/src/contexts/OnboardingContext";
import { createDefaultBehaviorProfile } from "@/src/services/user/behaviorProfileService";
import { randomAvatarUrl } from "@/src/components/supsona/supsona";
import { useFonts } from "expo-font";
import { captureError } from "@/src/lib/sentry";

const CODE_LENGTH = 6;

export default function VerifyEmailScreen() {
  const router = useRouter();
  const { verifyEmailOtp } = useAuth();
  const { pendingSignup, setPendingSignup, answers } = useOnboarding();

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  // Code verified but the profile didn't save — the button retries the save.
  const [saveFailed, setSaveFailed] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const [fontsLoaded] = useFonts({
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
    "Agrandir-Regular":    require("../../assets/fonts/Agrandir-Regular.otf"),
  });

  useEffect(() => {
    if (code.length === CODE_LENGTH) handleVerify(code);
  }, [code]);

  if (!fontsLoaded) return null;

  const handleVerify = async (value: string) => {
    if (verifying) return;
    setVerifying(true);
    setError("");

    const res = await verifyEmailOtp(pendingSignup.email, value);
    if (!res.success) {
      setError(res.error || "invalid or expired code");
      setVerifying(false);
      setCode("");
      return;
    }

    // If this email was signed up before but never verified (user backed out
    // of this screen and came round again), signUp only re-sent the code and
    // kept the FIRST password. Re-apply the one they just typed so it's the
    // one that works at login. "same_password" just means it already matched.
    const { error: pwError } = await supabase.auth.updateUser({ password: pendingSignup.password });
    if (pwError && pwError.code !== "same_password") {
      console.warn("[verify-email] failed to apply password", pwError);
      captureError(pwError, "signup-apply-password");
    }
    setPendingSignup({ ...pendingSignup, password: "" });

    await saveProfile();
  };

  // The code is used up once verified, so a failed save retries only this
  // part. Without a profile row, index.tsx signs the user out on next launch.
  const saveProfile = async () => {
    setVerifying(true);
    setError("");

    const fail = (err: unknown) => {
      console.warn("[verify-email] failed to save profile", err);
      captureError(err, "signup-profile-save");
      setVerifying(false);
      setSaveFailed(true);
      setError("couldn't save your profile, check your connection and try again");
    };

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail("no signed-in user");

    const { error: profileError } = await supabase.from("profiles").insert({
      id: user.id,
      name: pendingSignup.firstName,
      last_name: pendingSignup.lastName,
      username: pendingSignup.username,
      avatar_url: randomAvatarUrl(),
      current_streak: 0,
      weekly_avg_points: 0,
      how_heard: answers.howHeard,
      // Onboarding quiz answers — disabled with the quiz pages.
      // q1: answers.q1,
      // q2: answers.q2,
      // q3: answers.q3,
      // q4: answers.q4,
      // q5: answers.q5,
      // q6: answers.q6,
    });
    // 23505 = the row already exists, i.e. an earlier attempt saved it.
    if (profileError && profileError.code !== "23505") return fail(profileError);

    const def = createDefaultBehaviorProfile();
    const { error: behaviorError } = await supabase.from("user_profile").upsert({
      id: user.id,
      primary_goals: def.primaryGoals,
      preferred_tones: def.preferredTones,
      reminder_frequency: def.reminderFrequency,
      active_time_start: def.activeTimeStart,
      active_time_end: def.activeTimeEnd,
      weekly_goals: def.weeklyGoals,
    });
    if (behaviorError) return fail(behaviorError);

    setVerifying(false);
    setSaveFailed(false);
    router.push("/onboarding/final" as any);
  };

  return (
    <LinearGradient
      colors={["#AB99FA", "#ffffff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <View style={styles.content}>
        <Text style={styles.heading}>check your email</Text>
        <Text style={styles.subheading}>
          enter the 6-digit code we sent to{"\n"}
          <Text style={styles.emailText}>{pendingSignup.email}</Text>
        </Text>

        <Text style={styles.warningText}>💡 ensure that you check your spam/junk folder for the verification code!</Text>

        <Text style={styles.fieldLabel}>verification code</Text>
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(v) => setCode(v.replace(/[^0-9]/g, "").slice(0, CODE_LENGTH))}
          keyboardType="number-pad"
          maxLength={CODE_LENGTH}
          autoFocus
          editable={!verifying}
          placeholder="123456"
          placeholderTextColor="#A9A9C7"
          selectTextOnFocus
          // Lets the OS offer the code from the email instead of retyping it.
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          returnKeyType="done"
          onSubmitEditing={() => {
            if (code.length === CODE_LENGTH) handleVerify(code);
          }}
          style={styles.codeInput}
        />

        {saveFailed ? (
          <PressFeedback
            style={[styles.verifyBtn, verifying && styles.verifyBtnDisabled]}
            onPress={saveProfile}
            disabled={verifying}
          >
            <Text style={styles.verifyBtnText}>{verifying ? "saving..." : "try again"}</Text>
          </PressFeedback>
        ) : (
          <PressFeedback
            style={[styles.verifyBtn, (code.length !== CODE_LENGTH || verifying) && styles.verifyBtnDisabled]}
            onPress={() => handleVerify(code)}
            disabled={code.length !== CODE_LENGTH || verifying}
          >
            <Text style={styles.verifyBtnText}>{verifying ? "verifying..." : "verify"}</Text>
          </PressFeedback>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 40,
  },
  heading: {
    fontSize: 32,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#111",
    marginBottom: 12,
    textAlign: "center",
  },
  subheading: {
    fontSize: 16,
    fontFamily: "Agrandir-Regular",
    color: "#111",
    lineHeight: 24,
    textAlign: "center",
    marginBottom: 32,
  },
  emailText: {
    fontFamily: "Agrandir-GrandHeavy",
    color: "#5222AE",
  },
  warningText: {
    fontSize: 16,
    fontFamily: "Agrandir-Regular",
    fontWeight: "700",
    color: "#333",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 18,
  },
  fieldLabel: {
    fontSize: 14,
    fontFamily: "Agrandir-Regular",
    color: "#333",
    marginBottom: 8,
    alignSelf: "center",
  },
  codeInput: {
    width: "100%",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#CBCBF7",
    paddingVertical: 14,
    paddingHorizontal: 18,
    fontSize: 22,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#333",
    letterSpacing: 4,
    textAlign: "center",
    marginBottom: 20,
  },
  verifyBtn: {
    backgroundColor: "#AB99FA",
    borderRadius: 50,
    paddingVertical: 16,
    paddingHorizontal: 48,
    marginBottom: 16,
  },
  verifyBtnDisabled: {
    backgroundColor: "#ccc",
  },
  verifyBtnText: {
    fontSize: 16,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#ffffff",
    textAlign: "center",
  },
  errorText: {
    color: "#c0392b",
    fontSize: 14,
    fontFamily: "Agrandir-Regular",
    marginBottom: 12,
    textAlign: "center",
  },
});
