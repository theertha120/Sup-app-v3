import { Stack } from "expo-router";
import { AuthProvider } from "@/src/contexts/AuthContext";
import { IMUProvider } from "@/src/contexts/IMUContext";
import SignInModal from "@/src/components/SignInModal";

export default function RootLayout() {
  return (
    <AuthProvider>
      {/* IMUProvider wraps everything so sensor state persists
          across all screens — sensors never disconnect on navigation */}
      <IMUProvider>
        <Stack
          screenOptions={{
            headerShown: false,
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="modal" options={{ presentation: "modal" }} />
          <Stack.Screen name="supsona-builder" options={{ presentation: "modal", title: "Supsona" }} />
          <Stack.Screen name="settings" />
          <Stack.Screen name="sensor-setup" />
        </Stack>

        <SignInModal />
      </IMUProvider>
    </AuthProvider>
  );
}