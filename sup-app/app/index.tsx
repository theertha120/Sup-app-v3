import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { supabase } from "../src/lib/supabase";

export default function Index() {
  const [destination, setDestination] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;

        if (!user) {
          setDestination("/(tabs)/home");
          return;
        }

        const { data } = await supabase
          .from("profiles")
          .select("onboarding")
          .eq("id", user.id)
          .single();

        if (!data?.onboarding) {
          setDestination("/onboarding/intro");
        } else {
          setDestination("/(tabs)/home");
        }
      } catch (e) {
        console.warn("[index] check failed:", e);
        setDestination("/(tabs)/home");
      }
    };

    check();
  }, []);

  if (!destination) return null;

  return <Redirect href={destination as any} />;
}
