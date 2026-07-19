import React, { useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useOnboarding } from "@/src/contexts/OnboardingContext";

const OPTIONS = [
  { key: "A", text: "Kind of ruins it for me, feels like starting from zero." },
  { key: "B", text: "Annoying, but whatever, I just pick it back up." },
  { key: "C", text: "Guilty, because of me my friend also lost the streak." },
  { key: "D", text: "I've never stuck to a streak, I wouldn't know." },
];
const TOTAL_QUESTIONS = 6;
const CURRENT_QUESTION = 6;

export default function Question6Screen() {
  const router = useRouter();
  const { setQ6 } = useOnboarding();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <LinearGradient
      colors={["#AB99FA", "#ffffff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <View style={styles.topNav}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}> Back</Text>
        </TouchableOpacity>
        <Text style={styles.questionCounter}>Question {CURRENT_QUESTION} of {TOTAL_QUESTIONS}</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(CURRENT_QUESTION / TOTAL_QUESTIONS) * 100}%` }]} />
      </View>

      <View style={styles.card}>
        <Text style={styles.questionLabel}>Question {CURRENT_QUESTION}:</Text>
        <Text style={styles.questionBody}>
          15 days into a Snapchat streak. Day 16 you completely forget. How does the next morning go?
        </Text>
      </View>

      <View style={styles.options}>
        {OPTIONS.map(({ key, text }) => (
          <TouchableOpacity
            key={key}
            style={[styles.option, selected === key && styles.optionSelected]}
            onPress={() => { setSelected(key); setQ6(key); router.push("/onboarding/details" as any); }}
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
