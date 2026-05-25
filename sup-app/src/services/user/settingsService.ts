export type AppTheme = "light" | "dark" | "auto";
export type AppUnits = "metric" | "imperial";

export interface AppSettings {
  soundEffectsEnabled: boolean;
  theme: AppTheme;
  units: AppUnits;
}

const defaultSettings: AppSettings = {
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
