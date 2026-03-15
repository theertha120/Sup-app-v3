import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Image,
  Animated,
  StyleSheet,
  ImageSourcePropType,
  Easing,
} from "react-native";
import { DeskPostureState, getScoreColor } from "../data/mockDeskPostureData";
import { colours } from "../../theme/colours";

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
  const [displayedState, setDisplayedState] = useState<DeskPostureState>(state);
  const [incomingState, setIncomingState] = useState<DeskPostureState | null>(null);
  const transition = useRef(new Animated.Value(1)).current;
  const accentColor = getScoreColor(score);

  const displayedImage = STATE_IMAGE[displayedState];
  const incomingImage = incomingState ? STATE_IMAGE[incomingState] : null;

  // Smoothly crossfade between the previous and next posture figure.
  useEffect(() => {
    if (state === incomingState || state === displayedState) return;

    if (incomingState) {
      transition.stopAnimation();
      setDisplayedState(incomingState);
      setIncomingState(null);
    }

    setIncomingState(state);
    transition.setValue(0);

    Animated.timing(transition, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setDisplayedState(state);
      setIncomingState(null);
      transition.setValue(1);
    });
  }, [state, displayedState, incomingState, transition]);

  const currentOpacity = transition;
  const previousOpacity = transition.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const currentScale = transition.interpolate({
    inputRange: [0, 1],
    outputRange: [0.985, 1],
  });

  const previousScale = transition.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.015],
  });

  return (
    <View style={styles.scene}>
      <View
        style={[
          styles.baseShadow,
          { backgroundColor: hexToRgba(accentColor, 0.2) },
        ]}
      />

      {incomingImage ? (
        <Animated.View
          style={[
            styles.layer,
            {
              opacity: previousOpacity,
              transform: [
                displayedImage.mirror ? { scaleX: -1 } : { scaleX: 1 },
                { scale: previousScale },
              ],
            },
          ]}
        >
          <Image source={displayedImage.source} style={styles.image} resizeMode="contain" />
        </Animated.View>
      ) : (
        <View
          style={[
            styles.layer,
            {
              transform: [displayedImage.mirror ? { scaleX: -1 } : { scaleX: 1 }],
            },
          ]}
        >
          <Image source={displayedImage.source} style={styles.image} resizeMode="contain" />
        </View>
      )}

      {incomingImage && (
        <Animated.View
          style={[
            styles.layer,
            {
              opacity: currentOpacity,
              transform: [
                incomingImage.mirror ? { scaleX: -1 } : { scaleX: 1 },
                { scale: currentScale },
              ],
            },
          ]}
        >
          <Image source={incomingImage.source} style={styles.image} resizeMode="contain" />
        </Animated.View>
      )}
    </View>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  scene: {
    width: 260,
    height: 260,
    backgroundColor: colours.card,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  baseShadow: {
    position: "absolute",
    bottom: 16,
    width: 150,
    height: 16,
    borderRadius: 8,
    backgroundColor: colours.border,
    opacity: 0.35,
  },
  layer: {
    position: "absolute",
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "96%",
    height: "96%",
  },
});
