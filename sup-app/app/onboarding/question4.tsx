import React, { useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity, TextInput } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useOnboarding } from "@/src/contexts/OnboardingContext";
import { useFonts } from "expo-font";

const TOTAL_QUESTIONS = 6;
const CURRENT_QUESTION = 4;

export default function Question4Screen() {
  const router = useRouter();
  const { setQ4 } = useOnboarding();
  const [selected, setSelected] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");

  const [fontsLoaded] = useFonts({
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
    "Agrandir-Regular":    require("../../assets/fonts/Agrandir-Regular.otf"),
  });

  if (!fontsLoaded) return null;

  const handleSelect = (key: string) => {
    setSelected(key);
    setQ4(key);
    if (key !== "C") router.push("/onboarding/question5" as any);
  };

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
          Totally free day, no work, no plans. When is your brain actually locked in?
        </Text>
      </View>

      <View style={styles.options}>
        <TouchableOpacity
          style={[styles.option, selected === "A" && styles.optionSelected]}
          onPress={() => handleSelect("A")}
        >
          <Text style={[styles.optionText, selected === "A" && styles.optionTextSelected]}>
            A) First couple hours after I wake up.
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.option, selected === "B" && styles.optionSelected]}
          onPress={() => handleSelect("B")}
        >
          <Text style={[styles.optionText, selected === "B" && styles.optionTextSelected]}>
            B) Late afternoon or evening, I need time to warm up.
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.option, selected === "C" && styles.optionSelected]}
          onPress={() => handleSelect("C")}
        >
          <Text style={[styles.optionText, selected === "C" && styles.optionTextSelected]}>
            C) Other
          </Text>
        </TouchableOpacity>

        {selected === "C" && (
          <View>
            <TextInput
              style={styles.textInput}
              placeholder="Type your answer..."
              placeholderTextColor="#aaa"
              value={otherText}
              onChangeText={setOtherText}
              returnKeyType="done"
              multiline
            />
            <TouchableOpacity
              style={[styles.doneBtn, !otherText.trim() && styles.doneBtnDisabled]}
              onPress={() => { if (otherText.trim()) router.push("/onboarding/question5" as any); }}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
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
  textInput: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Agrandir-Regular",
    color: "#333",
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  doneBtn: {
    backgroundColor: "#5222AE",
    borderRadius: 50,
    paddingVertical: 14,
    alignItems: "center",
  },
  doneBtnDisabled: {
    backgroundColor: "#ccc",
  },
  doneBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Agrandir-GrandHeavy",
  },
});
