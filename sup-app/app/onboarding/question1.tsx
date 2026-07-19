import React, { useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useOnboarding } from "@/src/contexts/OnboardingContext";

const OPTIONS = [
  { key: "A", text: "Ngl the book just wasn't hitting." },
  { key: "B", text: "No one knew I was even doing this so it didn't feel that deep." },
  { key: "C", text: "The second it felt like homework, I was out." },
  { key: "D", text: "Just a rough week, I'll lock back in tomorrow." },
];
const TOTAL_QUESTIONS = 6;
const CURRENT_QUESTION = 1;

export default function Question1Screen() {
  const router = useRouter();
  const { setQ1 } = useOnboarding();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <LinearGradient
      colors={["#AB99FA", "#ffffff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      {/* Top nav */}
      <View style={styles.topNav}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}> Back</Text>
        </TouchableOpacity>
        <Text style={styles.questionCounter}>Question {CURRENT_QUESTION} of {TOTAL_QUESTIONS}</Text>
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(CURRENT_QUESTION / TOTAL_QUESTIONS) * 100}%` }]} />
      </View>

      {/* Question card */}
      <View style={styles.card}>
        <Text style={styles.questionLabel}>Question {CURRENT_QUESTION}:</Text>
        <Text style={styles.questionBody}>
          You told yourself you'd read every day. Three days in, you've missed all three. What's actually going on?
        </Text>
      </View>

      {/* Options */}
      <View style={styles.options}>
        {OPTIONS.map(({ key, text }) => (
          <TouchableOpacity
            key={key}
            style={[styles.option, selected === key && styles.optionSelected]}
            onPress={() => { setSelected(key); setQ1(key); router.push("/onboarding/question2" as any); }}
          >
            <Text style={[styles.optionText, selected === key && styles.optionTextSelected]}>
              {key}) {text}
            </Text>
          </TouchableOpacity>
        ))}
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
  topNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
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
    fontWeight: "700",
  },
  questionCounter: {
    fontSize: 18,
    color: "#333",
    fontWeight: "700",
  },
  progressTrack: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.4)",
    borderRadius: 4,
    marginBottom: 28,
  },
  progressFill: {
    height: 4,
    backgroundColor: "#5222AE",
    borderRadius: 4,
  },
  card: {
    backgroundColor: "#EDE8FF",
    borderRadius: 28,
    padding: 28,
    marginBottom: 20,
    width: "100%",
  },
  questionLabel: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111",
    marginBottom: 6,
    textAlign: "center",
  },
  questionBody: {
    fontSize: 22,
    fontWeight: "500",
    color: "#111",
    marginBottom: 10,
    textAlign: "center",
  },
  options: {
    width: "100%",
    gap: 20,
    marginTop: 12,
  },
  option: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  optionSelected: {
    backgroundColor: "#5222AE",
  },
  optionText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#5222AE",
  },
  optionTextSelected: {
    color: "#ffffff",
  },
});
