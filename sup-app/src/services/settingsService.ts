export type AppTheme = "light" | "dark" | "auto";
export type AppUnits = "metric" | "imperial";

export interface AppSettings {
  notificationsEnabled: boolean;
  friendRequestNotificationsEnabled: boolean;
  postureRemindersEnabled: boolean;
  postureReminderTime: string;
  dailyGoalsEnabled: boolean;
  soundEffectsEnabled: boolean;
  theme: AppTheme;
  units: AppUnits;
}

const defaultSettings: AppSettings = {
  notificationsEnabled: true,
  friendRequestNotificationsEnabled: true,
  postureRemindersEnabled: true,
  postureReminderTime: "09:00",
  dailyGoalsEnabled: false,
  soundEffectsEnabled: true,
  theme: "light",
  units: "metric",
};

let settingsState: AppSettings = { ...defaultSettings };

export function getSettingsSnapshot(): AppSettings {
  return { ...settingsState };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  settingsState = {
    ...settingsState,
    ...patch,
  };

  return { ...settingsState };
}
