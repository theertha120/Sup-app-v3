import React, { useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";

const OPTIONS = ["influencerr", "linkedin", "instagram", "tiktok", "friend/fam", "other"];

export default function HeardScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <LinearGradient
      colors={["#AB99FA", "#ffffff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <View style={styles.questionBubble}>
        <Text style={styles.questionText}>How did you{"\n"}hear about s'up?</Text>
      </View>

      <View style={styles.options}>
        {OPTIONS.map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.option, selected === option && styles.optionSelected]}
            onPress={() => { setSelected(option); router.push("/onboarding/question1" as any); }}
          >
            <Text style={[styles.optionText, selected === option && styles.optionTextSelected]}>
              {option}
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
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: 24,
  },
  questionBubble: {
    backgroundColor: "#EDE8FF",
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingVertical: 20,
    marginBottom: 32,
    width: "100%",
    alignItems: "center",
  },
  questionText: {
    fontSize: 28,
    fontWeight: "800",
    color: "#5222AE",
    textAlign: "center",
    lineHeight: 36,
  },
  options: {
    width: "100%",
    gap: 12,
  },
  option: {
    backgroundColor: "#ffffff",
    borderRadius: 50,
    paddingVertical: 16,
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
    fontWeight: "500",
    color: "#5222AE",
  },
  optionTextSelected: {
    color: "#ffffff",
  },
});
