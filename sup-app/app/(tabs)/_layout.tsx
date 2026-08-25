import React from "react";
import { Tabs } from "expo-router";
import { colours } from "@/theme/colours";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";
import LiquidGlass from "@/src/components/ui/LiquidGlass";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <LiquidGlass {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colours.primary,
        tabBarInactiveTintColor: "#9E9E9E",
        tabBarStyle: { display: "none" },
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
        name="home"
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

      <Tabs.Screen
        name="desk"
        options={{
          title: "Desk Mode",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="desktop-outline" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="daily"
        options={{
          title: "Daily Summary",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="today-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
