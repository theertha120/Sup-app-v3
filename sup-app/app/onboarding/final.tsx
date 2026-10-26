import PressFeedback from "@/src/components/ui/PressFeedback";
import React, { useState, useRef } from "react";
import { StyleSheet, View, Text, ScrollView, NativeSyntheticEvent, NativeScrollEvent, Linking } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";

const PRIVACY_POLICY_URL = "https://www.termsfeed.com/live/3d4b8e6c-82de-4104-a866-e52e4377ada4";

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
  const [gender, setGender] = useState("male");
  const [age, setAge] = useState(27);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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
      <Text style={styles.heading}>final s'tep!!</Text>
      <Text style={styles.subheading}>enter your details to start your journey!</Text>

      <View style={styles.card}>
        {/* Gender */}
        <Text style={styles.fieldLabel}>gender</Text>
        <View style={styles.genderRow}>
          {GENDERS.map((g) => (
            <PressFeedback
              key={g}
              style={[styles.genderBtn, gender === g && styles.genderBtnSelected]}
              onPress={() => setGender(g)}
            >
              <Text style={[styles.genderText, gender === g && styles.genderTextSelected]}>{g}</Text>
            </PressFeedback>
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
                <PressFeedback
                  key={value}
                  style={styles.agePickerItem}
                  onPress={() => { setAge(value); scrollToAge(value, true); }}
                >
                  <Text style={[styles.agePickerItemText, value === age && styles.agePickerItemTextSelected]}>
                    {value}
                  </Text>
                </PressFeedback>
              ))}
            </ScrollView>
          </View>
          <Text style={styles.ageNote}>this data is necessary to accurately determine your current s'pine health</Text>
        </View>

        {/* Checkbox */}
        <View style={styles.checkboxRow}>
          <PressFeedback onPress={() => setAccepted(!accepted)}>
            <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
              {accepted && <Ionicons name="checkmark" size={18} color="#5222AE" />}
            </View>
          </PressFeedback>
          <Text style={styles.checkboxLabel}>
            i accept the s'uper{" "}
            <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
              privacy policy
            </Text>
          </Text>
        </View>
      </View>

      <PressFeedback
        style={[styles.nextBtn, !accepted && styles.nextBtnDisabled]}
        disabled={saving}
        onPress={async () => {
          if (!accepted || saving) return;
          setSaving(true);
          setError("");
          const { data: { user } } = await supabase.auth.getUser();
          const { error: updateError } = user
            ? await supabase.from("profiles").update({
                gender,
                age,
                onboarding: true,
                // Onboarding quiz results — disabled with the quiz pages.
                // archetype: "",
                // chronotype: "",
                // interoception: "",
                // elasticity: "",
              }).eq("id", user.id)
            : { error: "no signed-in user" };
          setSaving(false);
          if (updateError) {
            console.warn("[onboarding/final] failed to save details", updateError);
            captureError(updateError, "signup-details-save");
            setError("couldn't save your details, check your connection and try again");
            return;
          }
          router.replace("/(tabs)/home" as any);
          router.push("/tutorial/intro" as any);
        }}
      >
        <Text style={styles.nextBtnText}>
          {saving ? "saving..." : "start your posture health journey"}
        </Text>
      </PressFeedback>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 125,
    paddingHorizontal: 24,
  },
  errorText: {
    color: "#c0392b",
    fontSize: 14,
    fontFamily: "Agrandir-Regular",
    marginTop: 12,
    textAlign: "center",
  },
  heading: {
    fontSize: 38,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#111",
    textAlign: "center",
    marginBottom: 10,
    marginTop: -20,
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
    borderWidth: 2,
    borderColor: "#5222AE",
    backgroundColor: "#EDE8FF",
    marginTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: "#EDE8FF",
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
