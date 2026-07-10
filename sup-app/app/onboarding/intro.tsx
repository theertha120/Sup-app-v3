import React, { useRef, useCallback, useEffect } from "react";
import { Animated, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import BackgroundBlobs from "../(tabs)/backgroundBlobs";
import { supabase } from "../../src/lib/supabase";

export default function IntroScreen() {
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

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <BackgroundBlobs />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "rgba(211, 193, 231, 0.64)",
  },
});
