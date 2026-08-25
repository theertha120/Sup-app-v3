import React from "react";
import { View, Pressable, Dimensions, StyleSheet, Image } from "react-native";
import { BlurView } from "expo-blur";
import Svg, { Defs, Mask, Rect } from "react-native-svg";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Animated, {
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { useAuth } from "@/src/contexts/AuthContext";
import { logNavbarClick, type NavbarTab } from "@/src/services/analytics/navbarClickService";

const { width } = Dimensions.get("window");

const TAB_BAR_WIDTH = width - 40;

const ROUTE_TO_TAB: Record<string, NavbarTab> = {
  home: "home",
  stats: "stats",
  leaderboard: "community",
  desk: "desk",
  daily: "today_summary",
};

// Matches the solid-silhouette-with-cutouts style of the nav_*.png icons,
// tinted the same way via `color` instead of Image's tintColor.
function DailyIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Defs>
        <Mask id="dailyMask" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <Rect x="0" y="0" width="24" height="24" fill="#fff" />
          <Rect x="3" y="10" width="18" height="1.6" fill="#000" />
          <Rect x="9.5" y="14" width="5" height="4" rx="1" fill="#000" />
        </Mask>
      </Defs>
      <Rect x="3" y="6" width="18" height="15" rx="3" fill={color} mask="url(#dailyMask)" />
      <Rect x="7" y="3" width="2.2" height="6" rx="1.1" fill={color} />
      <Rect x="14.8" y="3" width="2.2" height="6" rx="1.1" fill={color} />
    </Svg>
  );
}

export default function LiquidGlass({
  state,
  navigation,
}: BottomTabBarProps) {
  const { userId } = useAuth();
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
            const tab = ROUTE_TO_TAB[route.name];
            if (tab) logNavbarClick(userId, tab);

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
                {NAV_IMAGES[route.name] ? (
                  <Image
                    source={NAV_IMAGES[route.name]}
                    style={{ width: 24, height: 24, tintColor: isFocused ? "#111" : "#888" }}
                    resizeMode="contain"
                  />
                ) : (
                  <DailyIcon color={isFocused ? "#111" : "#888"} />
                )}
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