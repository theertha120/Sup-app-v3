import React from "react";
import { Stack, usePathname } from "expo-router";
import { AuthProvider, useAuth } from "@/src/contexts/AuthContext";
import { IMUProvider } from "@/src/contexts/IMUContext";
import SignInModal from "@/src/components/modals/SignInModal";
import { ToastProvider } from "@/src/contexts/ToastContext";
import { useReminderNotifications } from "@/src/hooks/useReminderNotifications";
import { OnboardingProvider } from "@/src/contexts/OnboardingContext";
import { TutorialProvider } from "@/src/contexts/TutorialContext";
import { initSentry, setSentryScreen, setSentryUser, wrapWithSentry } from "@/src/lib/sentry";
import { LeaderboardProvider } from "@/src/contexts/LeaderboardContext";
import { PostureHistoryProvider } from "@/src/contexts/PostureHistoryContext";
import OfflineGate from "@/src/components/ui/OfflineGate";

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

/** Tags crash reports with the screen the user was on (renders nothing). */
function SentryScreenSync() {
  const pathname = usePathname();
  React.useEffect(() => {
    setSentryScreen(pathname);
  }, [pathname]);
  return null;
}

function RootLayout() {
  // Initialize reminder notifications
  useReminderNotifications();

  return (
    <AuthProvider>
      <SentryUserSync />
      <SentryScreenSync />
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
          {/* Offline popup over every screen; remounts the Stack on reconnect */}
          <OfflineGate>
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
          </OfflineGate>

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
