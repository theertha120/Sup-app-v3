import { Stack } from "expo-router";

// Covers every screen in this folder: a render crash shows a retry screen
// and is reported to Sentry instead of taking down the whole app.
export { default as ErrorBoundary } from "@/src/components/ui/ScreenErrorBoundary";

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
