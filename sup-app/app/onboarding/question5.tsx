import React, { useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity, TextInput, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useOnboarding } from "@/src/contexts/OnboardingContext";
import { useFonts } from "expo-font";

const TOTAL_QUESTIONS = 6;
const CURRENT_QUESTION = 5;

export default function Question5Screen() {
  const router = useRouter();
  const { setQ5 } = useOnboarding();
  const [selected, setSelected] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");

  const [fontsLoaded] = useFonts({
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
    "Agrandir-Regular":    require("../../assets/fonts/Agrandir-Regular.otf"),
  });

  if (!fontsLoaded) return null;

  const handleSelect = (key: string) => {
    setSelected(key);
    setQ5(key);
    if (key !== "C") router.push("/onboarding/question6" as any);
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
          <Image source={require("../../assets/images/back.png")} style={styles.backImage} />
        </TouchableOpacity>
        <Text style={styles.questionCounter}>Question {CURRENT_QUESTION} of {TOTAL_QUESTIONS}</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(CURRENT_QUESTION / TOTAL_QUESTIONS) * 100}%` }]} />
      </View>

      <View style={styles.card}>
        <Text style={styles.questionLabel}>Question {CURRENT_QUESTION}:</Text>
        <Text style={styles.questionBody}>
          Trying to drink more water throughout the day, what actually helps it stick?
        </Text>
      </View>

      <View style={styles.options}>
        <TouchableOpacity
          style={[styles.option, selected === "A" && styles.optionSelected]}
          onPress={() => handleSelect("A")}
        >
          <Text style={[styles.optionText, selected === "A" && styles.optionTextSelected]}>
            A) Asking my friend who drinks enough water to remind me every time they drink water.
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.option, selected === "B" && styles.optionSelected]}
          onPress={() => handleSelect("B")}
        >
          <Text style={[styles.optionText, selected === "B" && styles.optionTextSelected]}>
            B) Listening to my body and just checking in with myself, am I actually thirsty or just tired.
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
              multiline
            />
            <TouchableOpacity
              style={[styles.doneBtn, !otherText.trim() && styles.doneBtnDisabled]}
              onPress={() => { if (otherText.trim()) router.push("/onboarding/question6" as any); }}
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
