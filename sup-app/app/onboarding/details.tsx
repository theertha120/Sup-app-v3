import PressFeedback from "@/src/components/ui/PressFeedback";
import React, { useState } from "react";
import { StyleSheet, View, Text, TextInput, KeyboardAvoidingView, ScrollView, Platform, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/contexts/AuthContext";
import { isUsernameTaken } from "@/src/services/user/profileService";
import { useOnboarding } from "@/src/contexts/OnboardingContext";
import { useFonts } from "expo-font";
import { captureError } from "@/src/lib/sentry";

export default function DetailsScreen() {
  const router = useRouter();
  const { register, checkEmailRegistered } = useAuth();
  const { setPendingSignup } = useOnboarding();

  const [fontsLoaded] = useFonts({
    "Agrandir-GrandHeavy": require("../../assets/fonts/Agrandir-GrandHeavy.otf"),
    "Agrandir-Regular":    require("../../assets/fonts/Agrandir-Regular.otf"),
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!fontsLoaded) return null;

  const normalizedEmail = email.trim().toLowerCase();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);

  const isValid =
    !!firstName.trim() &&
    !!lastName.trim() &&
    !!username.trim() &&
    emailValid &&
    !!password.trim() &&
    !!confirmPassword.trim();

  const handleNext = async () => {
    if (submitting) return;
    if (!firstName.trim() || !lastName.trim() || !username.trim() || !password.trim() || !confirmPassword.trim()) return;
    if (!emailValid) {
      setError("please enter a valid email");
      return;
    }
    if (password.length < 6) {
      setError("password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("passwords don't match");
      return;
    }
    setError("");

    // The checks and sign-up below are slow network calls; block repeat taps
    // so a second tap can't send a second sign-up.
    setSubmitting(true);
    try {
      await submit();
    } catch (err) {
      console.warn("[onboarding/details] submit failed", err);
      captureError(err, "signup-details-submit");
      setError("something went wrong, please try again");
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async () => {
    // Checked before registering, so a taken handle does not leave a stranded
    // auth user behind.
    if (await isUsernameTaken(username.trim())) {
      setError("that username is taken, try another one");
      return;
    }

    const check = await checkEmailRegistered(normalizedEmail);
    if (!check.success) {
      setError(check.error);
      return;
    }
    if (check.exists) {
      setError("this email is already registered, try signing in instead");
      return;
    }

    const res = await register(normalizedEmail, password);
    if (!res.success) {
      if (/email rate limit exceeded/i.test(res.error ?? "")) {
        setError("We've hit the email sending limit for now, please try again in about an hour");
      } else if (/only request this after/i.test(res.error ?? "")) {
        // Re-signing up with an unverified email re-sends the code, which
        // Supabase throttles to once a minute.
        setError("a code was just sent to this email, please wait a minute and try again");
      } else {
        setError(res.error || "registration failed");
      }
      return;
    }
    setPendingSignup({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalizedEmail,
      username: username.trim(),
      password,
    });
    router.push("/onboarding/verify-email" as any);
  };

  return (
    <LinearGradient
      colors={["#AB99FA", "#ffffff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.container}
    >
      <PressFeedback feedback="scale" onPress={() => router.back()} style={styles.backBtn}>
        <Image source={require("../../assets/images/back.png")} style={styles.backImage} />
      </PressFeedback>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.heading}>almost there!</Text>
          <Text style={styles.subheading}>enter your details!</Text>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>first name</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>last name</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.fieldLabel}>email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <Text style={styles.fieldLabel}>password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <Text style={styles.fieldLabel}>confirm password</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <PressFeedback
            style={[styles.nextBtn, (!isValid || submitting) && styles.nextBtnDisabled]}
            onPress={handleNext}
            disabled={submitting}
          >
            <Text style={styles.nextBtnText}>{submitting ? "creating account..." : "next"}</Text>
          </PressFeedback>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 0,
    paddingHorizontal: 24,
  },
  backBtn: {
    marginTop: 60,
    marginBottom: -20,
  },
  backImage: {
    width: 100,
    height: 100,
    resizeMode: "contain",
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingBottom: 0,
    paddingTop: -10,
  },
  heading: {
    fontSize: 36,
    fontFamily: "Agrandir-GrandHeavy",
    color: "#111",
    marginBottom: 0,
    marginTop: 0,
    textAlign: "center",
  },
  subheading: {
    fontSize: 20,
    fontFamily: "Agrandir-Regular",
    color: "#111",
    lineHeight: 28,
    textAlign: "center",
    marginBottom: 12,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    padding: 24,
    width: "100%",
  },
  fieldLabel: {
    fontSize: 14,
    fontFamily: "Agrandir-Regular",
    color: "#333",
    marginBottom: 6,
    marginLeft: 4,
  },
  input: {
    backgroundColor: "#CBCBF7",
    borderRadius: 50,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Agrandir-Regular",
    color: "#333",
    marginBottom: 16,
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
    fontFamily: "Agrandir-GrandHeavy",
    color: "#ffffff",
    textAlign: "center",
  },
  nextBtnDisabled: {
    backgroundColor: "#ccc",
  },
  errorText: {
    color: "#c0392b",
    fontSize: 14,
    fontFamily: "Agrandir-Regular",
    marginTop: 8,
    textAlign: "center",
  },
});
