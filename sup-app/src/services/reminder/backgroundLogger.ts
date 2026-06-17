import * as FileSystem from "expo-file-system/legacy";  // ← only change this line

const LOG_FILE = FileSystem.documentDirectory + "bg_task_log.txt";
const MAX_LINES = 200;

export async function bgLog(message: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  // Always console.log too — visible when foregrounded
  console.log(message);
  try {
    const existing = await FileSystem.readAsStringAsync(LOG_FILE).catch(() => "");
    const lines = existing.split("\n");
    // Trim to keep file small
    const trimmed = lines.slice(-MAX_LINES).join("\n");
    await FileSystem.writeAsStringAsync(LOG_FILE, trimmed + line);
  } catch (e) {
    // Don't throw — logging must never crash the task
  }
}

export async function readBgLog(): Promise<string> {
  try {
    return await FileSystem.readAsStringAsync(LOG_FILE);
  } catch {
    return "(no background log file found yet)";
  }
}

export async function clearBgLog(): Promise<void> {
  await FileSystem.writeAsStringAsync(LOG_FILE, "").catch(() => {});
}