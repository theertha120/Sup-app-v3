import React from "react";
import { StyleSheet, View, Image, Text, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";

export default function ClusterScreen() {
  const router = useRouter();
  return (
    <LinearGradient
      colors={["#AB99FA", "#ffffff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <Image
        source={require("../../assets/images/mascot.png")}
        style={styles.mascot}
        resizeMode="contain"
      />
      <View style={styles.speechBubble}>
        <Text style={styles.speechText}>s'time to find your</Text>
      </View>
      <Text style={styles.clusterTitle}>s'uper{"\n"}cluster</Text>
      <TouchableOpacity style={styles.button} onPress={() => router.push("/onboarding/heard" as any)}>
        <Text style={styles.buttonText}>s'tart now</Text>
      </TouchableOpacity>
      <Text style={styles.quizNote}>the quiz will take approximately 5 mins :)</Text>
      <View style={styles.content} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mascot: {
    position: "absolute",
    top: 48,
    right: 16,
    width: 160,
    height: 190,
  },
  content: {
    flex: 1,
  },
  speechBubble: {
    position: "absolute",
    top: 200,
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  speechText: {
    fontSize: 19,
    fontWeight: "700",
    color: "#333",
    textAlign: "center",
  },
  clusterTitle: {
    position: "absolute",
    top: 280,
    alignSelf: "center",
    fontSize: 100,
    fontWeight: "900",
    color: "#333",
    textAlign: "center",
    lineHeight: 120,
  },
  button: {
    position: "absolute",
    top: 540,
    alignSelf: "center",
    backgroundColor: "#5222AE",
    borderRadius: 30,
    paddingHorizontal: 48,
    paddingVertical: 16,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
  },
  quizNote: {
    position: "absolute",
    top: 610,
    alignSelf: "center",
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
});
