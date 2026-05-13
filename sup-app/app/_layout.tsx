import { Stack } from "expo-router";
import { AuthProvider } from "@/src/contexts/AuthContext";
import SignInModal from "@/src/components/modals/SignInModal";
import { ToastProvider } from "@/src/contexts/ToastContext";

export default function RootLayout() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Stack
          screenOptions={{
            headerShown: false,
          }}
        >
          {/* Tabs live inside the stack */}
          <Stack.Screen name="(tabs)" />

          {/* Optional modal screens */}
          <Stack.Screen name="(modals)" options={{ presentation: "modal" }} />

          {/* Settings screen */}
          <Stack.Screen name="settings" />
        </Stack>

        {/* Sign-in modal that shows on app open */}
        <SignInModal />
      </ToastProvider>
    </AuthProvider>
  );
}
