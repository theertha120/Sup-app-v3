import React from "react";
import { View, Pressable, Dimensions, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import Animated, {
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

const { width } = Dimensions.get("window");

const TAB_BAR_WIDTH = width - 40;
const TAB_COUNT = 4;
const TAB_WIDTH = TAB_BAR_WIDTH / TAB_COUNT;

export default function LiquidGlass({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const activeIndex = state.index;

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

  const getIcon = (routeName: string) => {
    switch (routeName) {
      case "home":
        return "home-outline";

      case "stats":
        return "bar-chart-outline";
    
      case "leaderboard":
        return "trophy-outline";

      case "desk":
        return "desktop-outline";

      default:
        return "ellipse";
    }
  };

  return (
    <View style={styles.wrapper}>
      <BlurView intensity={80} tint="light" style={styles.container}>
        <View style={styles.shine} />

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
                <Ionicons
                  name={getIcon(route.name)}
                  size={24}
                  color={isFocused ? "#111" : "#888"}
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
  },

  container: {
    height: 72,
    borderRadius: 36,
    overflow: "hidden",

    flexDirection: "row",
    alignItems: "center",

    backgroundColor: "rgba(255,255,255,0.15)",

    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },

  shine: {
    position: "absolute",

    top: 0,
    left: 0,
    right: 0,

    height: 20,

    backgroundColor: "rgba(255,255,255,0.15)",
  },

  activeBubble: {
    position: "absolute",

    width: 60,
    height: 60,

    borderRadius: 30,

    top: 6,

    backgroundColor: "rgba(255,255,255,0.45)",

    shadowColor: "#fff",
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },

  tab: {
    flex: 1,

    height: "100%",

    justifyContent: "center",
    alignItems: "center",
  },
});