import { supabase } from "@/src/lib/supabase";
import { getDeviceTimezoneOffset } from "@/src/lib/timezoneUtils";

/**
 * AUTO-DETECT AND SAVE USER TIMEZONE
 */
export async function autoDetectAndSaveTimezone(userId: string): Promise<void> {
  try {
    const timezoneOffsetMinutes = getDeviceTimezoneOffset();

    const { error } = await supabase
      .from("user_profile")
      .update({
        timezone_offset_minutes: timezoneOffsetMinutes,
      })
      .eq("id", userId);

    if (error) {
      console.warn("[timezone] failed to save timezone:", error);
    } else {
      console.log(
        `Timezone auto-detected and saved: ${timezoneOffsetMinutes} minutes offset`
      );
    }
  } catch (error) {
    console.error("Error auto-detecting timezone:", error);
  }
}
