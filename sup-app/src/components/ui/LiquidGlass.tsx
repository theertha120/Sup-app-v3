import React from "react";
import { View, Pressable, Dimensions, StyleSheet, Image } from "react-native";
import { BlurView } from "expo-blur";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Animated, {
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

const { width } = Dimensions.get("window");

const TAB_BAR_WIDTH = width - 40;

export default function LiquidGlass({
  state,
  navigation,
}: BottomTabBarProps) {
  const activeIndex = state.index;
  const TAB_WIDTH = TAB_BAR_WIDTH / state.routes.length;
  const { bottom: bottomInset } = useSafeAreaInsets();

  const animatedBubbleStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          translateX: withSpring(
            activeIndex * TAB_WIDTH + TAB_WIDTH / 2 - 30,
            {
              damping: 15,
              stiffness: 140,
            }
          ),
        },
      ],
    };
  });

  const NAV_IMAGES: Record<string, any> = {
    home:        require("../../../assets/images/nav_home.png"),
    stats:       require("../../../assets/images/nav_stats.png"),
    leaderboard: require("../../../assets/images/nav_community.png"),
    desk:        require("../../../assets/images/nav_desk.png"),
  };

  return (
    <View style={[styles.wrapper, { bottom: 25 + bottomInset }]}>
      <BlurView intensity={100} tint="light" style={styles.container}>
        <View style={styles.shine} />
        <View style={styles.shineBottom} />

        <Animated.View
          style={[styles.activeBubble, animatedBubbleStyle]}
        />

        {state.routes.map((route, index) => {
          const isFocused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const scaleStyle = useAnimatedStyle(() => ({
            transform: [
              {
                scale: withSpring(isFocused ? 1.15 : 1),
              },
            ],
          }));

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={styles.tab}
            >
              <Animated.View style={scaleStyle}>
                <Image
                  source={NAV_IMAGES[route.name]}
                  style={{ width: 24, height: 24, tintColor: isFocused ? "#111" : "#888" }}
                  resizeMode="contain"
                />
              </Animated.View>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 25,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 12,
  },

  container: {
    height: 72,
    borderRadius: 36,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.65)",
  },

  shine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 32,
    backgroundColor: "rgba(255,255,255,0.35)",
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
  },

  shineBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
  },

  activeBubble: {
    position: "absolute",
    width: 60,
    height: 60,
    borderRadius: 30,
    top: 6,
    backgroundColor: "rgba(255,255,255,0.62)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#fff",
    shadowOpacity: 0.6,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 2 },
  },

  tab: {
    flex: 1,
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
});