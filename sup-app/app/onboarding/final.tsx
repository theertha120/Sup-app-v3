import React, { useState, useRef } from "react";
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { supabase } from "@/src/lib/supabase";
import { useOnboarding } from "@/src/contexts/OnboardingContext";
import { useFonts } from "expo-font";

const GENDERS = ["male", "female", "other"];

const MIN_AGE = 5;
const MAX_AGE = 100;
const AGES = Array.from({ length: MAX_AGE - MIN_AGE + 1 }, (_, i) => MIN_AGE + i);

const AGE_ITEM_HEIGHT = 36;
const AGE_VISIBLE_ITEMS = 3;
const AGE_PICKER_HEIGHT = AGE_ITEM_HEIGHT * AGE_VISIBLE_ITEMS;
const AGE_PADDING = AGE_ITEM_HEIGHT * Math.floor(AGE_VISIBLE_ITEMS / 2);

export default function FinalScreen() {
  const router = useRouter();
  const { setAge: saveAgeToContext } = useOnboarding();
  const [gender, setGender] = useState("male");
  const [age, setAge] = useState(27);
  const [accepted, setAccepted] = useState(false);
  const ageScrollRef = useRef<ScrollView>(null);

  const [fontsLoaded] = useFonts({
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
    "Agrandir-Regular":    require("../../assets/fonts/Agrandir-Regular.otf"),
  });

  if (!fontsLoaded) return null;

  const scrollToAge = (value: number, animated: boolean) => {
    const index = AGES.indexOf(value);
    ageScrollRef.current?.scrollTo({ y: index * AGE_ITEM_HEIGHT, animated });
  };

  const handleAgeScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.y / AGE_ITEM_HEIGHT);
    const clamped = Math.min(AGES.length - 1, Math.max(0, index));
    setAge(AGES[clamped]);
  };

  return (
    <LinearGradient
      colors={["#AB99FA", "#ffffff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backArrow}>←</Text>
        <Text style={styles.backText}> Back</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>final s'tep!!</Text>
      <Text style={styles.subheading}>enter your details to start your journey!</Text>

      <View style={styles.card}>
        {/* Gender */}
        <Text style={styles.fieldLabel}>gender</Text>
        <View style={styles.genderRow}>
          {GENDERS.map((g) => (
            <TouchableOpacity
              key={g}
              style={[styles.genderBtn, gender === g && styles.genderBtnSelected]}
              onPress={() => setGender(g)}
            >
              <Text style={[styles.genderText, gender === g && styles.genderTextSelected]}>{g}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Age */}
        <View style={styles.ageSection}>
          <Text style={styles.fieldLabel}>age</Text>
          <View style={styles.agePicker}>
            <View style={styles.agePickerHighlight} pointerEvents="none" />
            <ScrollView
              ref={ageScrollRef}
              showsVerticalScrollIndicator={false}
              snapToInterval={AGE_ITEM_HEIGHT}
              decelerationRate="fast"
              contentContainerStyle={{ paddingVertical: AGE_PADDING }}
              onMomentumScrollEnd={handleAgeScrollEnd}
              onScrollEndDrag={handleAgeScrollEnd}
              onContentSizeChange={() => scrollToAge(age, false)}
            >
              {AGES.map((value) => (
                <TouchableOpacity
                  key={value}
                  style={styles.agePickerItem}
                  onPress={() => { setAge(value); scrollToAge(value, true); }}
                >
                  <Text style={[styles.agePickerItemText, value === age && styles.agePickerItemTextSelected]}>
                    {value}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <Text style={styles.ageNote}>this data is necessary to accurately determine your current s'pine health</Text>
        </View>

        {/* Checkbox */}
        <View style={styles.checkboxRow}>
          <TouchableOpacity onPress={() => setAccepted(!accepted)}>
            <View style={[styles.checkbox, accepted && styles.checkboxChecked]} />
          </TouchableOpacity>
          <Text style={styles.checkboxLabel}>
            i accept the s'uper{" "}
            <Text style={styles.link}>terms and conditions</Text>
          </Text>
        </View>

        <Text style={styles.privacyLink}>click here to read our privacy policy</Text>
      </View>

      <TouchableOpacity
        style={[styles.nextBtn, !accepted && styles.nextBtnDisabled]}
        onPress={async () => {
          if (!accepted) return;
          saveAgeToContext(age);
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await supabase.from("profiles").update({
              gender,
              age,
              onboarding: true,
              archetype: "",
              chronotype: "",
              interoception: "",
              elasticity: "",
            }).eq("id", user.id);
          }
          router.replace("/" as any);
        }}
      >
        <Text style={styles.nextBtnText}>start your posture health journey</Text>
      </TouchableOpacity>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 32,
    paddingHorizontal: 24,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  backArrow: {
    fontSize: 26,
    color: "#333",
    fontWeight: "700",
    lineHeight: 28,
    marginBottom: 7,
  },
  backText: {
    fontSize: 18,
    color: "#333",
    fontFamily: "Agrandir-GrandHeavy",
  },
  heading: {
    fontSize: 38,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#111",
    textAlign: "center",
    marginBottom: 10,
  },
  subheading: {
    fontSize: 20,
    fontFamily: "Agrandir-Regular",
    color: "#111",
    textAlign: "center",
    lineHeight: 30,
    marginBottom: 24,
  },
  card: {
    backgroundColor: "#EDE8FF",
    borderRadius: 28,
    padding: 24,
    width: "100%",
  },
  fieldLabel: {
    fontSize: 15,
    fontFamily: "Agrandir-Regular",
    color: "#333",
    marginBottom: 10,
  },
  genderRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 24,
  },
  genderBtn: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 50,
    paddingVertical: 10,
    alignItems: "center",
  },
  genderBtnSelected: {
    backgroundColor: "#AB99FA",
  },
  genderText: {
    fontSize: 14,
    fontFamily: "Agrandir-Regular",
    color: "#333",
  },
  genderTextSelected: {
    color: "#ffffff",
  },
  ageSection: {
    marginBottom: 24,
  },
  agePicker: {
    height: AGE_PICKER_HEIGHT,
    borderRadius: 16,
    overflow: "hidden",
    marginTop: 4,
  },
  agePickerHighlight: {
    position: "absolute",
    left: 0,
    right: 0,
    top: AGE_PADDING,
    height: AGE_ITEM_HEIGHT,
    borderRadius: 10,
    backgroundColor: "#D0C8F0",
  },
  agePickerItem: {
    height: AGE_ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  agePickerItemText: {
    fontSize: 18,
    fontFamily: "Agrandir-Regular",
    color: "#999",
  },
  agePickerItemTextSelected: {
    fontSize: 22,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#5222AE",
  },
  ageNote: {
    fontSize: 12,
    fontFamily: "Agrandir-Regular",
    color: "#777",
    lineHeight: 17,
    marginTop: 6,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: "#D0C8F0",
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: "#5222AE",
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Agrandir-Regular",
    color: "#333",
    lineHeight: 20,
  },
  link: {
    color: "#5222AE",
    textDecorationLine: "underline",
    fontFamily: "Agrandir-Regular",
  },
  privacyLink: {
    fontSize: 13,
    fontFamily: "Agrandir-Regular",
    color: "#5222AE",
    textDecorationLine: "underline",
    textAlign: "center",
  },
  nextBtn: {
    backgroundColor: "#5222AE",
    borderRadius: 50,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginTop: 24,
    alignSelf: "center",
  },
  nextBtnText: {
    fontSize: 16,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#ffffff",
    textAlign: "center",
  },
  nextBtnDisabled: {
    backgroundColor: "#ccc",
  },
});
