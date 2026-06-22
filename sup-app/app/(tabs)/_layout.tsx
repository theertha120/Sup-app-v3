import { Tabs } from "expo-router";
import LiquidGlass from "../../src/components/ui/LiquidGlass";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <LiquidGlass {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
        }}
      />

      <Tabs.Screen
        name="stats"
        options={{
          title: "Stats",
        }}
      />

      <Tabs.Screen
        name="desk"
        options={{
          title: "Desk",
        }}
      />

      <Tabs.Screen
        name="quests"
        options={{
          title: "S'Quest",
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
        }}
      />
    </Tabs>
  );
}