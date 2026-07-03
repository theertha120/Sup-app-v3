// import { supabase } from "@/src/lib/supabase";
// import { getReminderForUser } from "./reminderEngineService";

// // expo-notifications is not installed on this branch (apple-testing).
// // All notification functions are no-ops that preserve the Supabase tracking side-effects
// // so the reminder engine still runs and logs correctly — just no OS popups.

// async function getCurrentUserId(): Promise<string> {
//   try {
//     const { data: { user }, error } = await supabase.auth.getUser();
//     if (error || !user) return "guest";
//     return user.id;
//   } catch {
//     return "guest";
//   }
// }

// async function updateReminderSentTracking(userId: string): Promise<void> {
//   try {
//     const { data: state, error: fetchError } = await supabase
//       .from("behaviour_state")
//       .select("reminders_sent_today")
//       .eq("id", userId)
//       .maybeSingle();

//     if (fetchError) {
//       console.error("Error fetching behaviour_state for tracking:", fetchError);
//       return;
//     }

//     const current = Number(state?.reminders_sent_today ?? 0);
//     const now = new Date().toISOString();

//     const { error } = await supabase
//       .from("behaviour_state")
//       .upsert(
//         { id: userId, reminders_sent_today: current + 1, last_reminder_time: now },
//         { onConflict: "id" }
//       );

//     if (error) console.error("Supabase upsert error (reminder tracking):", error);
//   } catch (error) {
//     console.error("Error updating reminder tracking:", error);
//   }
// }

// export async function setupNotifications(): Promise<void> {
//   console.log("[Notifications disabled] setupNotifications — no-op on apple-testing branch");
// }

// export async function sendLocalNotification(
//   title: string,
//   body: string,
//   _actionLabel?: string,
//   _urgent: boolean = false
// ): Promise<void> {
//   console.log("[Notifications disabled] would have sent:", { title, body });
//   const userId = await getCurrentUserId();
//   await updateReminderSentTracking(userId);
// }

// export async function triggerReminder(): Promise<void> {
//   try {
//     const userId = await getCurrentUserId();
//     await supabase
//       .from("user_profile")
//       .update({ last_app_interaction_at: new Date().toISOString() })
//       .eq("id", userId)
//       .maybeSingle();

//     const reminder = await getReminderForUser();
//     if (reminder) {
//       await sendLocalNotification(reminder.title, reminder.body);
//       console.log("[Notifications disabled] reminder engine ran:", reminder.title);
//     }
//   } catch (error) {
//     console.error("Error triggering reminder:", error);
//   }
// }

// export function setupNotificationListeners(): () => void {
//   return () => {};
// }

// export function startReminderCheckInterval(intervalSeconds: number = 300): () => void {
//   const interval = setInterval(() => { triggerReminder(); }, intervalSeconds * 1000);
//   return () => clearInterval(interval);
// }
