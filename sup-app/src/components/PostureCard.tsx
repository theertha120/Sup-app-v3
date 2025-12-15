import { View, Text, StyleSheet } from "react-native";
import { colours } from "../../theme/colours";

export default function PostureCard() {
  const postureScore = 82;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Good posture</Text>
      <Text style={styles.score}>{postureScore}</Text>
      <Text style={styles.label}>Posture score</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colours.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colours.border,
  },
  title: {
    color: colours.primary,
    fontSize: 18,
    marginBottom: 8,
  },
  score: {
    color: colours.primary,
    fontSize: 48,
    fontWeight: "700",
    textAlign: "center",
  },
  label: {
    color: colours.textSecondary,
    textAlign: "center",
  },
});
