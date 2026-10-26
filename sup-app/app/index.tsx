import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { supabase } from "../src/lib/supabase";
import { captureError } from "../src/lib/sentry";

export default function Index() {
  const [destination, setDestination] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        // getUser() checks the saved login with Supabase. getSession() only
        // reads it from the phone, so a login for an account that was deleted
        // (or is otherwise no longer valid) would still look signed in.
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (!user) {
          if (userError) {
            console.log("[index] saved login no longer valid → sign out, home:", userError.message);
            await supabase.auth.signOut({ scope: "local" });
          } else {
            console.log("[index] no user → home");
          }
          setDestination("/(tabs)/home");
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("onboarding")
          .eq("id", user.id)
          .maybeSingle();

        if (error) {
          // Couldn't read the profile (e.g. offline) — don't push a signed-in
          // user into onboarding over a network blip.
          console.warn("[index] profile check failed → home:", error.message);
          captureError(error, "startup-profile-check");
          setDestination("/(tabs)/home");
          return;
        }

        if (!data) {
          // Signed in, but the signup never got as far as creating a profile.
          // Onboarding should only start from the "Create account" button, so
          // sign out and show the normal logged-out home screen instead.
          console.warn("[index] signed in with no profile row → sign out, home");
          // Usually means a signup's profile save failed — worth knowing about.
          captureError(new Error("Signed in with no profile row"), "startup-missing-profile");
          await supabase.auth.signOut({ scope: "local" });
          setDestination("/(tabs)/home");
          return;
        }

        console.log("[index] onboarding value:", data.onboarding);

        if (!data.onboarding) {
          console.log("[index] → onboarding/intro");
          setDestination("/onboarding/intro");
        } else {
          console.log("[index] → home");
          setDestination("/(tabs)/home");
        }
      } catch (e) {
        console.warn("[index] check failed:", e);
        captureError(e, "startup-check");
        setDestination("/(tabs)/home");
      }
    };

    check();
  }, []);

  if (!destination) return null;

  return <Redirect href={destination as any} />;
}
