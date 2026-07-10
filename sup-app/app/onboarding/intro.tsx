import React, { useRef, useCallback } from "react";
import { Animated, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import BackgroundBlobs from "../(tabs)/backgroundBlobs";

export default function IntroScreen() {
  const fadeAnim = useRef(new Animated.Value(0)).current;

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
