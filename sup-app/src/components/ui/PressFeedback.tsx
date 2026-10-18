import React, { forwardRef } from "react";
import { Pressable, StyleSheet, processColor, type PressableProps, type View } from "react-native";
import { getPressFeedback } from "@/src/lib/pressFeedback";

interface PressFeedbackProps extends PressableProps {
  feedback?: "button" | "link" | "scale";
}

/** Adds transient feedback while preserving the caller's handlers and styles. */
const PressFeedback = forwardRef<View, PressFeedbackProps>(function PressFeedback(
  { style, disabled, feedback = "button", ...props }, ref,
) {
  return (
    <Pressable
      {...props}
      ref={ref}
      disabled={disabled}
      style={state => {
        const baseStyle = typeof style === "function" ? style(state) : style;
        const flat = StyleSheet.flatten(baseStyle) ?? {};
        const color = state.pressed && !disabled && feedback === "button"
          ? processColor(flat.backgroundColor)
          : undefined;
        return [baseStyle, getPressFeedback(flat, state.pressed, !!disabled, feedback, color)];
      }}
    />
  );
});

export default PressFeedback;
