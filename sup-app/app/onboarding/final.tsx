import React, { useState, useRef } from "react";
import { StyleSheet, View, Text, TouchableOpacity, PanResponder } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { supabase } from "@/src/lib/supabase";
import { useOnboarding } from "@/src/contexts/OnboardingContext";

const GENDERS = ["male", "female", "other"];

const MIN_AGE = 18;
const MAX_AGE = 100;

export default function FinalScreen() {
  const router = useRouter();
  const { setAge: saveAgeToContext } = useOnboarding();
  const [gender, setGender] = useState("male");
  const [age, setAge] = useState(27);
  const [accepted, setAccepted] = useState(false);
  const trackWidth = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        if (trackWidth.current === 0) return;
        const x = e.nativeEvent.locationX;
        const ratio = Math.min(1, Math.max(0, x / trackWidth.current));
        setAge(Math.round(MIN_AGE + ratio * (MAX_AGE - MIN_AGE)));
      },
      onPanResponderMove: (e) => {
        if (trackWidth.current === 0) return;
        const x = e.nativeEvent.locationX;
        const ratio = Math.min(1, Math.max(0, x / trackWidth.current));
        setAge(Math.round(MIN_AGE + ratio * (MAX_AGE - MIN_AGE)));
      },
    })
  ).current;

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
      <Text style={styles.subheading}>enter your details to reveal{"\n"}your s'upercluster</Text>

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
          <View style={styles.ageHeader}>
            <Text style={styles.fieldLabel}>age</Text>
            <Text style={styles.ageValue}>{age}</Text>
          </View>
          <View
            style={styles.sliderTrack}
            onLayout={(e) => { trackWidth.current = e.nativeEvent.layout.width; }}
            {...panResponder.panHandlers}
          >
            <View style={[styles.sliderFill, { width: `${((age - MIN_AGE) / (MAX_AGE - MIN_AGE)) * 100}%` as any }]} />
            <View style={[styles.sliderThumb, { left: `${((age - MIN_AGE) / (MAX_AGE - MIN_AGE)) * 100}%` as any }]} />
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
            await supabase.from("profiles").update({ gender, age }).eq("id", user.id);
          }
          router.push("/onboarding/result" as any);
        }}
      >
        <Text style={styles.nextBtnText}>next</Text>
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
    fontWeight: "700",
  },
  heading: {
    fontSize: 38,
    fontWeight: "900",
    color: "#111",
    textAlign: "center",
    marginBottom: 10,
  },
  subheading: {
    fontSize: 20,
    fontWeight: "500",
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
    fontWeight: "600",
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
    fontWeight: "600",
    color: "#333",
  },
  genderTextSelected: {
    color: "#ffffff",
  },
  ageSection: {
    marginBottom: 24,
  },
  ageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  ageValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#5222AE",
  },
  sliderTrack: {
    height: 8,
    backgroundColor: "#D0C8F0",
    borderRadius: 4,
    marginBottom: 10,
    position: "relative",
    justifyContent: "center",
  },
  sliderFill: {
    height: 8,
    backgroundColor: "#5222AE",
    borderRadius: 4,
    position: "absolute",
    left: 0,
  },
  sliderThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#5222AE",
    position: "absolute",
    marginLeft: -11,
    top: -7,
  },
  ageNote: {
    fontSize: 12,
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
    color: "#333",
    lineHeight: 20,
  },
  link: {
    color: "#5222AE",
    textDecorationLine: "underline",
    fontWeight: "600",
  },
  privacyLink: {
    fontSize: 13,
    color: "#5222AE",
    textDecorationLine: "underline",
    textAlign: "center",
  },
  nextBtn: {
    backgroundColor: "#AB99FA",
    borderRadius: 50,
    paddingVertical: 16,
    paddingHorizontal: 48,
    marginTop: 20,
    alignSelf: "center",
  },
  nextBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
  },
  nextBtnDisabled: {
    backgroundColor: "#ccc",
  },
});
