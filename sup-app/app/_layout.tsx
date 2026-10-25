import React from "react";
import { Stack } from "expo-router";
import { AuthProvider, useAuth } from "@/src/contexts/AuthContext";
import { IMUProvider } from "@/src/contexts/IMUContext";
import SignInModal from "@/src/components/modals/SignInModal";
import { ToastProvider } from "@/src/contexts/ToastContext";
import { useReminderNotifications } from "@/src/hooks/useReminderNotifications";
import { OnboardingProvider } from "@/src/contexts/OnboardingContext";
import { TutorialProvider } from "@/src/contexts/TutorialContext";
import { initSentry, setSentryUser, wrapWithSentry } from "@/src/lib/sentry";
import { LeaderboardProvider } from "@/src/contexts/LeaderboardContext";
import { PostureHistoryProvider } from "@/src/contexts/PostureHistoryContext";

// Must run at module load so native + JS crash handlers are installed before render.
initSentry();

/** Tags crash reports with the signed-in user's id (renders nothing). */
function SentryUserSync() {
  const { userId } = useAuth();
  React.useEffect(() => {
    setSentryUser(userId);
  }, [userId]);
  return null;
}

function RootLayout() {
  // Initialize reminder notifications
  useReminderNotifications();

  return (
    <AuthProvider>
      <SentryUserSync />
      <OnboardingProvider>
      <TutorialProvider>
      <ToastProvider>
        {/* Leaderboard screens share a cache and load ranked pages on demand. */}
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
export default wrapWithSentry(RootLayout);
