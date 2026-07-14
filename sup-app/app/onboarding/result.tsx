import React from "react";
import { StyleSheet, View, Text, Image, ScrollView, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { supabase } from "@/src/lib/supabase";
import { useOnboarding } from "@/src/contexts/OnboardingContext";
import { computeOnboardingResult, ARCHETYPE_DISPLAY, type Archetype } from "./archetypeScoring";

const ARCHETYPE_IMAGE: Record<Archetype, any> = {
  Compiler:   require("../../assets/images/compiler.png"),
  Autonomist: require("../../assets/images/autonomist.png"),
  Strategist: require("../../assets/images/strategist.png"),
  Ritualist:  require("../../assets/images/ritualist.png"),
};

export default function ResultScreen() {
  const router = useRouter();
  const { answers } = useOnboarding();

  const result = computeOnboardingResult(
    answers.q1, answers.q2, answers.q3, answers.q4, answers.q5, answers.q6,
  );
  const display = ARCHETYPE_DISPLAY[result.archetype];

  return (
    <LinearGradient
      colors={["#AB99FA", "#ffffff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.header}>~~RESULTS~~</Text>

          <View style={styles.imageContainer}>
            <Image
              source={ARCHETYPE_IMAGE[result.archetype]}
              style={styles.shrimpImage}
              resizeMode="contain"
            />
          </View>

          <View style={styles.clusterPill}>
            <Text style={styles.clusterName}>{display.label}</Text>
          </View>

          <Text style={styles.description}>{display.description}</Text>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>s'pine age</Text>
              <Text style={styles.statValue}>{display.spineAge}</Text>
              <Text style={styles.statSub}>{display.spineSub}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statQuote}>{display.quote}</Text>
            </View>
          </View>

          <View style={styles.tagsRow}>
            <View style={styles.tag}>
              <Text style={styles.tagLabel}>chronotype</Text>
              <Text style={styles.tagValue}>{result.chronotype}</Text>
            </View>
            <View style={styles.tag}>
              <Text style={styles.tagLabel}>elasticity</Text>
              <Text style={styles.tagValue}>{result.elasticity}</Text>
            </View>
            <View style={styles.tag}>
              <Text style={styles.tagLabel}>interoception</Text>
              <Text style={styles.tagValue}>{result.interoception}</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.downloadBtn}
          onPress={async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              await supabase.from("profiles").update({
                onboarding: true,
                archetype: result.archetype,
                chronotype: result.chronotype,
                interoception: result.interoception,
                elasticity: result.elasticity,
              }).eq("id", user.id);
            }
            router.replace("/" as any);
          }}
        >
          <Text style={styles.downloadBtnText}>start your posture health journey</Text>
        </TouchableOpacity>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: "#EDE8FF",
    borderRadius: 28,
    padding: 24,
    width: "100%",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#C4B8F8",
  },
  header: {
    fontSize: 24,
    fontWeight: "900",
    color: "#2D1A6E",
    textAlign: "center",
    marginBottom: 20,
    letterSpacing: 1,
  },
  imageContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  shrimpImage: {
    width: 120,
    height: 100,
  },
  clusterPill: {
    backgroundColor: "#AB99FA",
    borderRadius: 50,
    paddingHorizontal: 32,
    paddingVertical: 10,
    marginBottom: 16,
  },
  clusterName: {
    fontSize: 20,
    fontWeight: "800",
    color: "#ffffff",
    textAlign: "center",
  },
  description: {
    fontSize: 16,
    color: "#333",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
    textAlign: "center",
  },
  statValue: {
    fontSize: 28,
    fontWeight: "900",
    color: "#2D1A6E",
    marginBottom: 4,
    textAlign: "center",
  },
  statSub: {
    fontSize: 12,
    color: "#555",
    textAlign: "center",
  },
  statQuote: {
    fontSize: 15,
    fontWeight: "600",
    color: "#2D1A6E",
    lineHeight: 22,
    fontStyle: "italic",
    textAlign: "center",
  },
  tagsRow: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
    marginTop: 4,
  },
  tag: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  tagLabel: {
    fontSize: 10,
    color: "#888",
    marginBottom: 3,
    textAlign: "center",
  },
  tagValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#5222AE",
    textAlign: "center",
  },
  downloadBtn: {
    backgroundColor: "#5222AE",
    borderRadius: 50,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginTop: 24,
    alignSelf: "center",
  },
  downloadBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
  },
});
