import React from "react";
import { StyleSheet, View, Text, Image, ScrollView, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { supabase } from "@/src/lib/supabase";

export default function ResultScreen() {
  const router = useRouter();
  return (
    <LinearGradient
      colors={["#AB99FA", "#ffffff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          {/* Header */}
          <Text style={styles.header}>~~RESULTS~~</Text>

          {/* Shrimp image with oval bg */}
          <View style={styles.imageContainer}>
            <Image
              source={require("../../assets/images/shrimp.png")}
              style={styles.shrimpImage}
              resizeMode="contain"
            />
          </View>

          {/* Cluster name pill */}
          <View style={styles.clusterPill}>
            <Text style={styles.clusterName}>the shrimp</Text>
          </View>

          {/* Description */}
          <Text style={styles.description}>
            you can lock in for hours, but your body pays the price
          </Text>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>s'pine age</Text>
              <Text style={styles.statValue}>47?!</Text>
              <Text style={styles.statSub}>this ain't it fam...</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statQuote}>"i'll take a break later..."</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.downloadBtn}
          onPress={async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              await supabase.from("profiles").update({ onboarding: true }).eq("id", user.id);
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
