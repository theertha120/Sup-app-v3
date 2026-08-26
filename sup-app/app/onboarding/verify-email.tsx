import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity, TextInput, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { supabase } from "@/src/lib/supabase";
import { useAuth } from "@/src/contexts/AuthContext";
import { useOnboarding } from "@/src/contexts/OnboardingContext";
import { createDefaultBehaviorProfile } from "@/src/services/user/behaviorProfileService";
import { useFonts } from "expo-font";

const CODE_LENGTH = 6;

export default function VerifyEmailScreen() {
  const router = useRouter();
  const { verifyEmailOtp } = useAuth();
  const { pendingSignup, answers } = useOnboarding();

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
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

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").insert({
        id: user.id,
        name: pendingSignup.firstName,
        last_name: pendingSignup.lastName,
        avatar_url: null,
        current_streak: 0,
        weekly_avg_points: 0,
        how_heard: answers.howHeard,
        q1: answers.q1,
        q2: answers.q2,
        q3: answers.q3,
        q4: answers.q4,
        q5: answers.q5,
        q6: answers.q6,
      });

      const def = createDefaultBehaviorProfile();
      await supabase.from("user_profile").upsert({
        id: user.id,
        primary_goals: def.primaryGoals,
        preferred_tones: def.preferredTones,
        reminder_frequency: def.reminderFrequency,
        active_time_start: def.activeTimeStart,
        active_time_end: def.activeTimeEnd,
        weekly_goals: def.weeklyGoals,
      });
    }

    setVerifying(false);
    router.push("/onboarding/final" as any);
  };

  return (
    <LinearGradient
      colors={["#AB99FA", "#ffffff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backArrow}>←</Text>
        <Text style={styles.backText}> back</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.heading}>check your email</Text>
        <Text style={styles.subheading}>
          enter the 6-digit code we sent to{"\n"}
          <Text style={styles.emailText}>{pendingSignup.email}</Text>
        </Text>

        <Pressable style={styles.codeRow} onPress={() => inputRef.current?.focus()}>
          {Array.from({ length: CODE_LENGTH }).map((_, i) => (
            <View key={i} style={[styles.codeBox, i === code.length && styles.codeBoxActive]}>
              <Text style={styles.codeDigit}>{code[i] ?? ""}</Text>
            </View>
          ))}
        </Pressable>

        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(v) => setCode(v.replace(/[^0-9]/g, "").slice(0, CODE_LENGTH))}
          keyboardType="number-pad"
          maxLength={CODE_LENGTH}
          autoFocus
          style={styles.hiddenInput}
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {verifying ? <Text style={styles.statusText}>verifying...</Text> : null}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 32,
    paddingHorizontal: 24,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  backArrow: {
    fontSize: 26,
    color: "#333",
    fontWeight: "700",
    lineHeight: 28,
    marginBottom: 7,
  },
  backText: {
    fontSize: 18,
    color: "#333",
    fontFamily: "Agrandir-GrandHeavy",
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
  codeRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 24,
  },
  codeBox: {
    width: 34,
    height: 46,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#CBCBF7",
  },
  codeBoxActive: {
    borderColor: "#5222AE",
  },
  codeDigit: {
    fontSize: 18,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#333",
  },
  hiddenInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  errorText: {
    color: "#c0392b",
    fontSize: 14,
    fontFamily: "Agrandir-Regular",
    marginBottom: 12,
    textAlign: "center",
  },
  statusText: {
    color: "#5222AE",
    fontSize: 14,
    fontFamily: "Agrandir-Regular",
    marginBottom: 12,
    textAlign: "center",
  },
});
