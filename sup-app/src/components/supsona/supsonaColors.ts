import type { HairColourId, SkinToneId, ShirtColourId } from "../../types/supsona";

export const HAIR_COLOR_MAP: Record<HairColourId, string> = {
  black: "#2C2C2C",
  brown: "#5D4037",
  blonde: "#F5DEB3",
  auburn: "#A52A2A",
  grey: "#9E9E9E",
  blue: "#5C6BC0",
  pink: "#F48FB1",
};

export const SKIN_TONE_MAP: Record<SkinToneId, string> = {
  "warm-light": "#FFE0BD",
  light: "#F1C27D",
  medium: "#E0AC69",
  tan: "#C68642",
  deep: "#8D5524",
};

export const SHIRT_COLOR_MAP: Record<ShirtColourId, string> = {
  white: "#FFFFFF",
  navy: "#1E3A5F",
  red: "#E53935",
  green: "#43A047",
  yellow: "#FDD835",
  lavender: "#B39DDB",
  coral: "#FF8A65",
};
