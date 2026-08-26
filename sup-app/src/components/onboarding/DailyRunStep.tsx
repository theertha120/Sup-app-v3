import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFonts } from "expo-font";
import React from "react";

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const suffix = i < 12 ? "AM" : "PM";
  const display = i === 0 ? 12 : i > 12 ? i - 12 : i;
  return { label: `${display}:00 ${suffix}`, value: i };
});

export default function DailyRunStep({
  value,
  onChange,
  summaryGeneratedToday,
}: {
  value: number;
  onChange: (hour: number) => void;
  summaryGeneratedToday: boolean;
}) {
  const [fontsLoaded] = useFonts({
    "Agrandir-Regular": require("../../../assets/fonts/Agrandir-Regular.otf"),
    "Agrandir-GrandHeavy": require("../../../assets/fonts/Agrandir-GrandHeavy.otf"),
  });

  const [open, setOpen] = useState(false);

  if (!fontsLoaded) return null;

  const selected = HOURS.find((h) => h.value === value) ?? HOURS[8];
  
  const disclaimerText = summaryGeneratedToday
    ? "Your daily prompt has already been generated for today. Your new time will take effect from tomorrow."
    : "Your daily prompt hasn't run yet today. If you save now, it will trigger at your new selected time today.";
  
    return (
    <View style={styles.step}>
      <View style={styles.group}>
        <Text style={styles.title}>when should your daily prompt appear?</Text>

        {/* Trigger */}
        <Pressable
          style={[styles.trigger, open && styles.triggerOpen]}
          onPress={() => setOpen((prev) => !prev)}
        >
          <Text style={styles.triggerText}>{selected.label}</Text>
          <Text style={styles.caret}>{open ? "▲" : "▼"}</Text>
        </Pressable>

        {/* Dropdown — rendered in normal flow, no negative margin */}
        {open && (
          <View style={styles.dropdown}>
            <ScrollView
              style={styles.scrollList}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {HOURS.map(({ label, value: hour }) => {
                const isSelected = value === hour;
                return (
                  <Pressable
                    key={hour}
                    style={[styles.option, isSelected && styles.optionSelected]}
                    onPress={() => {
                      onChange(hour);
                      setOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        isSelected && styles.optionTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>

      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>{disclaimerText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  step: {
    gap: 18,
  },
  group: {
    gap: 12,
  },
  title: {
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 18,
    color: "#1D014A",
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#AB99FA",
    backgroundColor: "#FFFFFF",
  },
  triggerOpen: {
    borderColor: "#AB99FA",
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  triggerText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 15,
    color: "#1D014A",
    includeFontPadding: false,
  },
  caret: {
    fontFamily: "Agrandir-Regular",
    fontSize: 11,
    color: "#AB99FA",
    includeFontPadding: false,
  },
  dropdown: {
    borderWidth: 1,
    borderColor: "#AB99FA",
    borderTopWidth: 0,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  scrollList: {
    maxHeight: 200,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(29, 1, 74, 0.06)",
  },
  optionSelected: {
    backgroundColor: "rgba(171, 153, 250, 0.12)",
  },
  optionText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 14,
    color: "#1D014A",
    includeFontPadding: false,
  },
  optionTextSelected: {
    fontFamily: "Agrandir-Regular",
    color: "#AB99FA",
  },
  checkmark: {
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    color: "#AB99FA",
    includeFontPadding: false,
  },
  disclaimer: {
    backgroundColor: "rgba(171, 153, 250, 0.12)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  disclaimerText: {
    fontFamily: "Agrandir-Regular",
    fontSize: 12,
    color: "#1D014A",
    opacity: 0.65,
    lineHeight: 18,
  },
});