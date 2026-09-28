import React from "react";
import { Stack } from "expo-router";
import { AuthProvider } from "@/src/contexts/AuthContext";
import { IMUProvider } from "@/src/contexts/IMUContext";
import SignInModal from "@/src/components/modals/SignInModal";
import { ToastProvider } from "@/src/contexts/ToastContext";
import { useReminderNotifications } from "@/src/hooks/useReminderNotifications";
import { OnboardingProvider } from "@/src/contexts/OnboardingContext";
import { TutorialProvider } from "@/src/contexts/TutorialContext";
import { LeaderboardProvider } from "@/src/contexts/LeaderboardContext";
import { PostureHistoryProvider } from "@/src/contexts/PostureHistoryContext";

export default function RootLayout() {
  // Initialize reminder notifications
  useReminderNotifications();

  return (
    <AuthProvider>
      <OnboardingProvider>
      <TutorialProvider>
      <ToastProvider>
        {/* Leaderboard data is fetched once per login and shared by both
            leaderboard screens; refreshes are user-triggered. */}
        <LeaderboardProvider>
        {/* The signed-in user’s own posture history, fetched once per login. */}
        <PostureHistoryProvider>
        {/* IMUProvider wraps everything so sensor state persists across screens */}
        <IMUProvider>
          <Stack
            screenOptions={{
              headerShown: false,
            }}
          >
            {/* Main tabs */}
            <Stack.Screen name="(tabs)" />

            {/* Modal screens */}
            <Stack.Screen
              name="(modals)/posture-tip"
              options={{ presentation: "modal" }}
            />

            <Stack.Screen
              name="(modals)/supsona-builder"
              options={{ presentation: "modal" }}
            />

            {/* Settings */}
            <Stack.Screen name="settings" />

            {/* Sensor setup */}
            <Stack.Screen name="sensor-setup" />

            {/* Onboarding */}
            <Stack.Screen name="onboarding" />

            {/* Post-onboarding tutorial */}
            <Stack.Screen
              name="tutorial"
              options={{ presentation: "transparentModal" }}
            />
          </Stack>

          {/* Global auth modal */}
          <SignInModal />
        </IMUProvider>
        </PostureHistoryProvider>
        </LeaderboardProvider>
      </ToastProvider>
      </TutorialProvider>
      </OnboardingProvider>
    </AuthProvider>
  );
}