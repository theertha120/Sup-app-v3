import React, { useRef, useCallback, useEffect } from "react";
import { Animated, StyleSheet, Text, View, Image, Pressable, TouchableOpacity } from "react-native";
import { useFonts } from "expo-font";

import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import BackgroundBlobs from "@/src/components/ui/BackgroundBlobs";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "@/src/contexts/AuthContext";

export default function IntroScreen() {
  const [fontsLoaded] = useFonts({
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      supabase
        .from("profiles")
        .update({ onboarding: true })
        .eq("id", session.user.id);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }, [fadeAnim])
  );

  if (!fontsLoaded) return null;

  const { stopRegistration } = useAuth();

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <BackgroundBlobs />

      <TouchableOpacity
        onPress={() => {
          stopRegistration();
          router.back();
        }}
        style={styles.backBtn}
      >
        <Image source={require("../../assets/images/back.png")} style={styles.backImage} />
      </TouchableOpacity>

      <View style={styles.content}>
        {/* Card */}
        <View style={styles.card}>
          <Text style={styles.heading}>
            {"S'TIME TO\nGET\nS'TARTED\nON YOUR\nS'PINE\nCARE\nJOURNEY!"}
          </Text>
        </View>

        {/* Coach s'kipper badge */}
        <View style={styles.skipperWrap}>
          <View style={styles.skipperBadge}>
            <Text style={styles.skipperBadgeText}>with coach s'kipper!</Text>
          </View>
          <Image
            source={require("../../assets/images/mascot.png")}
            style={styles.skipperImage}
            resizeMode="contain"
          />
        </View>

        {/* Button */}
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => router.push("/onboarding/heard" as any)}
        >
          <Text style={styles.buttonText}>Let's gooooo</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "rgba(211, 193, 231, 0.64)",
  },
  backBtn: {
    position: "absolute",
    top: 60,
    left: 24,
    zIndex: 10,
  },
  backImage: {
    width: 100,
    height: 100,
    resizeMode: "contain",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 24,
  },
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    borderRadius: 28,
    paddingTop: 32,
    paddingHorizontal: 28,
    paddingBottom: 28,
    width: "100%",
  },
  heading: {
    fontSize: 30,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#111",
    textAlign: "center",
    letterSpacing: 0.5,
    lineHeight: 42,
  },
  skipperWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: -10,
    marginBottom: -8,
  },
  skipperImage: {
    width: 130,
    height: 130,
    marginLeft: -70,
    marginRight: -50,
    zIndex: 2,
  },
  skipperBadge: {
    backgroundColor: "#5222AE",
    borderRadius: 50,
    paddingVertical: 14,
    paddingHorizontal: 32,
    paddingRight: 56,
    zIndex: 1,
  },
  skipperBadgeText: {
    fontSize: 16,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#fff",
    textAlign: "center",
  },
  button: {
    backgroundColor: "#AB99FA",
    borderRadius: 50,
    paddingVertical: 16,
    paddingHorizontal: 48,
    marginTop: -20,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonText: {
    fontSize: 16,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#fff",
    textAlign: "center",
  },
});
