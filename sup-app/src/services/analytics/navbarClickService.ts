import { supabase } from "@/src/lib/supabase";

export type NavbarTab = "home" | "stats" | "community" | "desk" | "today_summary";

export async function logNavbarClick(userId: string | null, tab: NavbarTab): Promise<void> {
  if (!userId) return;
  try {
    const { error } = await supabase.rpc("increment_navbar_click", {
      p_user_id: userId,
      p_tab: tab,
    });
    if (error) console.warn("[navbarClicks] failed to log click", error);
  } catch (e) {
    console.warn("[navbarClicks] threw while logging click", e);
  }
}
