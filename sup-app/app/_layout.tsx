import { Stack } from "expo-router";
import { AuthProvider } from "@/src/contexts/AuthContext";
import { IMUProvider } from "@/src/contexts/IMUContext";
import SignInModal from "@/src/components/modals/SignInModal";
import { ToastProvider } from "@/src/contexts/ToastContext";
import { useReminderNotifications } from "@/src/hooks/useReminderNotifications";
import { OnboardingProvider } from "@/src/contexts/OnboardingContext";

export default function RootLayout() {
  // Initialize reminder notifications
  useReminderNotifications();

  return (
    <AuthProvider>
      <OnboardingProvider>
      <ToastProvider>
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
          </Stack>

          {/* Global auth modal */}
          <SignInModal />
        </IMUProvider>
      </ToastProvider>
      </OnboardingProvider>
    </AuthProvider>
  );
}