import React, { useEffect, useRef } from "react";
import {
  View,
  Image,
  Animated,
  StyleSheet,
  ImageSourcePropType,
} from "react-native";
import { DeskPostureState, getScoreColor } from "../data/mockDeskPostureData";

interface Props {
  state: DeskPostureState;
  score: number;
}

// Map every state to its image source + whether to mirror horizontally
const STATE_IMAGE: Record<
  DeskPostureState,
  { source: ImageSourcePropType; mirror: boolean }
> = {
  upright:      { source: require("../../assets/images/good.png"),      mirror: false },
  forward_lean: { source: require("../../assets/images/forward.png"),   mirror: false },
  slouched:     { source: require("../../assets/images/slouching.png"), mirror: false },
  tilted_right: { source: require("../../assets/images/lean.png"),      mirror: false },
  tilted_left:  { source: require("../../assets/images/lean.png"),      mirror: true  },
};

export default function DeskPostureFigure({ state, score }: Props) {
  const opacity  = useRef(new Animated.Value(1)).current;
  const accentColor = getScoreColor(score);

  const { source, mirror } = STATE_IMAGE[state];

  // Fade out → swap image → fade in on every state change
  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
  }, [state]);

  return (
    <View style={styles.card}>
      {/* Coloured accent bar at top that reflects posture score */}
      <View style={[styles.accentBar, { backgroundColor: accentColor }]} />

      <Animated.View
        style={[
          styles.imageWrapper,
          { opacity },
          mirror && styles.mirrored,
        ]}
      >
        <Image
          source={source}
          style={styles.image}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 260,
    height: 280,
    borderRadius: 20,
    backgroundColor: "#F3F0FF",
    overflow: "hidden",
    alignItems: "center",
  },
  accentBar: {
    width: "100%",
    height: 5,
  },
  imageWrapper: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  mirrored: {
    transform: [{ scaleX: -1 }],
  },
});
