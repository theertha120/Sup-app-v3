import React, { useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useOnboarding } from "@/src/contexts/OnboardingContext";
import { useFonts } from "expo-font";

const OPTIONS = [
  { key: "A", text: "The streak, I haven't skipped in weeks and it feels clean." },
  { key: "B", text: "Texting a friend or posting it immediately." },
  { key: "C", text: "Pulling up the numbers and actually seeing the progress." },
  { key: "D", text: "Just knowing I showed up for me, no one had to remind me." },
];
const TOTAL_QUESTIONS = 6;
const CURRENT_QUESTION = 2;

export default function Question2Screen() {
  const router = useRouter();
  const { setQ2 } = useOnboarding();
  const [selected, setSelected] = useState<string | null>(null);

  const [fontsLoaded] = useFonts({
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
    "Agrandir-Regular":    require("../../assets/fonts/Agrandir-Regular.otf"),
  });

  if (!fontsLoaded) return null;

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
          You just hit a new PR at the gym. What's the part that actually feels good?
        </Text>
      </View>

      <View style={styles.options}>
        {OPTIONS.map(({ key, text }) => (
          <TouchableOpacity
            key={key}
            style={[styles.option, selected === key && styles.optionSelected]}
            onPress={() => { setSelected(key); setQ2(key); router.push("/onboarding/question3" as any); }}
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
    transform: [{ translateY: -1 }],
  },
  backText: {
    fontSize: 18,
    lineHeight: 28,
    color: "#333",
    fontFamily: "Agrandir-GrandHeavy",
  },
  questionCounter: {
    fontSize: 18,
    color: "#333",
    fontFamily: "Agrandir-GrandHeavy",
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
    fontFamily: "Agrandir-GrandHeavy",
    color: "#111",
    marginBottom: 6,
    textAlign: "center",
  },
  questionBody: {
    fontSize: 22,
    fontFamily: "Agrandir-Regular",
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
    fontFamily: "Agrandir-Regular",
    color: "#5222AE",
  },
  optionTextSelected: {
    color: "#ffffff",
  },
});
