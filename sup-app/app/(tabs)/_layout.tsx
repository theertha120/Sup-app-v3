import { Tabs } from "expo-router";
import { colours } from "@/theme/colours";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colours.primary,
        tabBarInactiveTintColor: "#9E9E9E",
        tabBarStyle: {
          borderTopColor: colours.border,
        },
        animation: "shift",
        // Add smooth transition animation
        ...Platform.select({
          ios: {
            animation: "shift",
          },
          android: {
            animation: "shift",
          },
          default: {
            animation: "fade",
          },
        }),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="stats"
        options={{
          title: "Stats",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart-outline" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="leaderboard"
        options={{
          title: "Leaderboard",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
