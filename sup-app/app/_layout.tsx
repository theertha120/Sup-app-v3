import { Stack } from "expo-router";
import { AuthProvider } from "@/src/contexts/AuthContext";
import SignInModal from "@/src/components/SignInModal";

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        {/* Tabs live inside the stack */}
        <Stack.Screen name="(tabs)" />

        {/* Optional modal screen */}
        <Stack.Screen name="modal" options={{ presentation: "modal" }} />
        <Stack.Screen name="supsona-builder" options={{ presentation: "modal", title: "Supsona" }} />
      </Stack>

      {/* Sign-in modal that shows on app open */}
      <SignInModal />
    </AuthProvider>
  );
}
