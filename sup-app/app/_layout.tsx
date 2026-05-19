import { Stack } from "expo-router";
import { AuthProvider } from "@/src/contexts/AuthContext";
import { IMUProvider } from "@/src/contexts/IMUContext";
import SignInModal from "@/src/components/modals/SignInModal";
import { ToastProvider } from "@/src/contexts/ToastContext";

export default function RootLayout() {
  return (
    <AuthProvider>
      <ToastProvider>
        {/* IMUProvider wraps everything so sensor state persists
            across all screens */}
        <IMUProvider>
          <Stack
            screenOptions={{
              headerShown: false,
            }}
          >
            {/* Main tabs */}
            <Stack.Screen name="(tabs)" />

            {/* Modal group */}
            <Stack.Screen
              name="(modals)"
              options={{ presentation: "modal" }}
            />

            {/* Existing modal routes */}
            <Stack.Screen
              name="supsona-builder"
              options={{
                presentation: "modal",
                title: "Supsona",
              }}
            />

            {/* Settings */}
            <Stack.Screen name="settings" />

            {/* Sensor setup */}
            <Stack.Screen name="sensor-setup" />
          </Stack>

          {/* Global auth modal */}
          <SignInModal />
        </IMUProvider>
      </ToastProvider>
    </AuthProvider>
  );
}