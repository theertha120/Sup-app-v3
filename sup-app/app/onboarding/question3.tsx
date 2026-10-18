import PressFeedback from "@/src/components/ui/PressFeedback";
import React, { useState } from "react";
import { StyleSheet, View, Text, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useOnboarding } from "@/src/contexts/OnboardingContext";
import { useFonts } from "expo-font";

const OPTIONS = [
  { key: "A", text: "Same time as always, I'll rearrange everything else around it." },
  { key: "B", text: "Random reminders throughout the day until one actually lands." },
  { key: "C", text: "No reminder, I'll just do it whenever it feels right." },
  { key: "D", text: "I'll do the 2 minute version just to keep the streak alive." },
];
const TOTAL_QUESTIONS = 6;
const CURRENT_QUESTION = 3;

export default function Question3Screen() {
  const router = useRouter();
  const { setQ3 } = useOnboarding();
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
        <PressFeedback feedback="scale" onPress={() => router.back()} style={styles.backBtn}>
          <Image source={require("../../assets/images/back.png")} style={styles.backImage} />
        </PressFeedback>
        <Text style={styles.questionCounter}>Question {CURRENT_QUESTION} of {TOTAL_QUESTIONS}</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(CURRENT_QUESTION / TOTAL_QUESTIONS) * 100}%` }]} />
      </View>

      <View style={styles.card}>
        <Text style={styles.questionLabel}>Question {CURRENT_QUESTION}:</Text>
        <Text style={styles.questionBody}>
          Tomorrow is packed, meetings, errands, zero breathing room. How do you actually keep a habit alive that day?
        </Text>
      </View>

      <View style={styles.options}>
        {OPTIONS.map(({ key, text }) => (
          <PressFeedback
            key={key}
            style={[styles.option, selected === key && styles.optionSelected]}
            onPress={() => { setSelected(key); setQ3(key); router.push("/onboarding/question4" as any); }}
          >
            <Text style={[styles.optionText, selected === key && styles.optionTextSelected]}>
              {key}) {text}
            </Text>
          </PressFeedback>
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
  },
  backImage: {
    width: 100,
    height: 100,
    resizeMode: "contain",
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
