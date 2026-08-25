import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { useRouter } from "expo-router";
import { useFonts } from "expo-font";
import { colours } from "@/theme/colours";
import BackgroundBlobs from "@/src/components/ui/BackgroundBlobs";
import { useTutorial } from "@/src/contexts/TutorialContext";

export default function TutorialIntroScreen() {
  const router = useRouter();
  const { startTutorial } = useTutorial();

  const [fontsLoaded] = useFonts({
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
    "Agrandir-Regular":    require("../../assets/fonts/Agrandir-Regular.otf"),
  });

  if (!fontsLoaded) return null;

  return (
    <View style={styles.overlay}>
      <BackgroundBlobs />

      <View style={styles.card}>
        <Text style={styles.heading}>hey there!{"\n"}wa-s'up!</Text>

        <Image
          source={require("../../assets/images/mascot.png")}
          style={styles.mascot}
          resizeMode="contain"
        />

        <Text style={styles.body}>
          I'm s'kipper and I will be your coach in your spine health journey.
          {"\n\n"}
          Let's start off with a tutorial!
        </Text>

        <TouchableOpacity
          style={styles.startBtn}
          onPress={() => {
            startTutorial();
            router.back();
          }}
        >
          <Text style={styles.startBtnText}>s'tart now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(211, 193, 231, 0.64)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },

  card: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    paddingTop: 20,
    paddingBottom: 28,
    paddingHorizontal: 24,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },

  heading: {
    fontSize: 26,
    fontFamily: "Agrandir-GrandHeavy",
    color: colours.primary,
    textAlign: "center",
    lineHeight: 32,
    marginTop: 8,
    marginBottom: 12,
  },

  mascot: {
    width: 240,
    height: 240,
    marginBottom: -60,
  },

  body: {
    fontSize: 15,
    fontFamily: "Agrandir-Regular",
    color: "#333",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },

  startBtn: {
    backgroundColor: colours.primary,
    borderRadius: 50,
    paddingVertical: 16,
    paddingHorizontal: 40,
    alignSelf: "stretch",
  },
  startBtnText: {
    fontSize: 16,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#ffffff",
    textAlign: "center",
  },
});
