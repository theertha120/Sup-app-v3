import type { ViewStyle } from "react-native";

export function getPressFeedback(
  base: ViewStyle,
  pressed: boolean,
  disabled: boolean,
  feedback: "button" | "link" | "scale",
  color: unknown,
): ViewStyle | undefined {
  if (!pressed || disabled) return undefined;
  if (feedback === "link") {
    return { opacity: (typeof base.opacity === "number" ? base.opacity : 1) * 0.55 };
  }
  const transform: ViewStyle["transform"] = typeof base.transform === "string"
    ? `${base.transform} scale(0.97)`
    : [...(base.transform ?? []), { scale: 0.97 }];
  if (feedback === "scale") return { transform };

  // processColor returns ARGB. Keep translucent buttons translucent, and
  // darken their existing colour instead of replacing every colour with purple.
  let backgroundColor = "rgba(29, 1, 74, 0.12)";
  if (typeof color === "number" && (color >>> 24) !== 0) {
    const red = Math.round(((color >>> 16) & 255) * 0.84);
    const green = Math.round(((color >>> 8) & 255) * 0.84);
    const blue = Math.round((color & 255) * 0.84);
    backgroundColor = `rgba(${red}, ${green}, ${blue}, ${(color >>> 24) / 255})`;
  }

  return {
    backgroundColor,
    transform,
  };
}
