import { View, Text, StyleSheet } from "react-native";
import { colours } from "@/theme/colours";

type PromptCardProps = {
  message?: string;
};

export default function PromptCard({
  message = "Try a 30-second shoulder reset 🌿",
}: PromptCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colours.primarySoft,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginTop: 16,
  },

  text: {
    fontSize: 15,
    color: colours.textPrimary,
    textAlign: "center",
    lineHeight: 20,
  },
});
