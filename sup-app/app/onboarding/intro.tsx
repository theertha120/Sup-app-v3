import React, { useRef, useCallback, useEffect } from "react";
import { Animated, StyleSheet, Text, View, Image, Pressable } from "react-native";
import { useFonts } from "expo-font";

import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import BackgroundBlobs from "../(tabs)/backgroundBlobs";
import { supabase } from "../../src/lib/supabase";

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

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <BackgroundBlobs />

      <View style={styles.content}>
        {/* Card */}
        <View style={styles.card}>
          <Text style={styles.heading}>
            {"s'time to\nget\ns'tarted\non your\ns'pine\ncare\njourney!"}
          </Text>
        </View>

        {/* Intro image below card */}
        <Image
          source={require("../../assets/images/intro.png")}
          style={styles.introImage}
          resizeMode="contain"
        />

        {/* Button */}
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => router.push("/onboarding/heard" as any)}
        >
          <Text style={styles.buttonText}>let's gooooo</Text>
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
  introImage: {
    width: "100%",
    height: 140,
    marginTop: -10,
    marginBottom: -8,
  },
  button: {
    backgroundColor: "#AB99FA",
    borderRadius: 50,
    paddingVertical: 16,
    paddingHorizontal: 48,
    marginTop: -16,
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
