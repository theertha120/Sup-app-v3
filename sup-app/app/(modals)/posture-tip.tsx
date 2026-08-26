import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { colours } from "@/theme/colours";

export default function PostureTipScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>posture tip</Text>

      <Text style={styles.body}>
        Gently lift your chest and allow your shoulders to soften downwards. Try
        holding this posture for 30 seconds while breathing calmly.
      </Text>

      <Pressable style={styles.button} onPress={() => router.back()}>
        <Text style={styles.buttonText}>done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colours.background,
    padding: 24,
    justifyContent: "center",
  },

  title: {
    fontSize: 22,
    fontWeight: "600",
    color: colours.textPrimary,
    marginBottom: 12,
    textAlign: "center",
  },

  body: {
    fontSize: 16,
    color: colours.textSecondary,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 24,
  },

  button: {
    alignSelf: "center",
    backgroundColor: colours.primary,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 24,
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "500",
  },
});
