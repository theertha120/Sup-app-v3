import PressFeedback from "@/src/components/ui/PressFeedback";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from "react-native";
import { useState, useEffect } from "react";
import React from "react";
import { BrandAlert } from "../ui/BrandAlert";
import { useFonts } from "expo-font";
import { colours } from "@/theme/colours";
import { useAuth } from "@/src/contexts/AuthContext";
import { useRouter } from "expo-router";

type ModalStep = "signin" | "forgot-email" | "forgot-code" | "forgot-newpassword";

export default function SignInModal() {
  const {
    isAuthenticated,
    registrationMode,
    startRegistration,
    login,
    checkEmailRegistered,
    requestPasswordReset,
    verifyPasswordResetOtp,
    updatePassword,
  } = useAuth();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    "Agrandir-GrandHeavy": require("../../../assets/fonts/Agrandir-GrandHeavy.otf"),
    "Agrandir-Regular":    require("../../../assets/fonts/Agrandir-Regular.otf"),
  });

  const [step, setStep] = useState<ModalStep>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [signInAlert, setSignInAlert] = useState<{ title: string; message?: string } | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setEmail("");
      setPassword("");
    }
  }, [isAuthenticated]);

  function validateEmail(value: string): boolean {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(value.toLowerCase());
  }

  const handleSignIn = async () => {
    setEmailError(null);
    setPasswordError(null);

    if (!validateEmail(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }

    if (password.length < 6) {
      setPasswordError("Password must be at least 6 characters");
      return;
    }

    const res = await login(email, password);
    if (!res.success) {
      setSignInAlert({
        title: "sign in failed",
        message: res.error || "invalid credentials. please try again.",
      });
    } else {
      router.replace("/(tabs)/home" as any);
    }
  };

  const resetToSignIn = () => {
    setStep("signin");
    setResetEmail("");
    setResetCode("");
    setNewPassword("");
    setConfirmNewPassword("");
    setResetError(null);
  };

  const handleSendResetCode = async () => {
    setResetError(null);
    if (!validateEmail(resetEmail)) {
      setResetError("Please enter a valid email address");
      return;
    }
    setResetLoading(true);
    const check = await checkEmailRegistered(resetEmail.trim());
    if (!check.success || !check.exists) {
      setResetLoading(false);
      setResetError(check.success ? "there's no account with this email, check the spelling or create an account" : check.error);
      return;
    }
    const res = await requestPasswordReset(resetEmail.trim());
    setResetLoading(false);
    if (!res.success) {
      if (/email rate limit exceeded/i.test(res.error ?? "")) {
        setResetError("We've hit the email sending limit for now, please try again in about an hour");
      } else if (/only request this after/i.test(res.error ?? "")) {
        // Supabase allows one reset code per email per minute.
        setResetError("a code was just sent to this email, please wait a minute and try again");
      } else {
        setResetError(res.error || "Failed to send reset code");
      }
      return;
    }
    setStep("forgot-code");
  };

  const handleVerifyResetCode = async () => {
    setResetError(null);
    if (resetCode.trim().length === 0) {
      setResetError("Please enter the code from your email");
      return;
    }
    setResetLoading(true);
    const res = await verifyPasswordResetOtp(resetEmail.trim(), resetCode.trim());
    setResetLoading(false);
    if (!res.success) {
      setResetError(res.error || "Invalid or expired code");
      return;
    }
    setStep("forgot-newpassword");
  };

  const handleSetNewPassword = async () => {
    setResetError(null);
    if (newPassword.length < 6) {
      setResetError("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setResetError("Passwords don't match");
      return;
    }
    setResetLoading(true);
    const res = await updatePassword(newPassword);
    setResetLoading(false);
    if (!res.success) {
      setResetError(res.error || "Failed to update password");
      return;
    }
    setStep("signin");
    router.replace("/(tabs)/home" as any);
  };

  if (!fontsLoaded) return null;

  return (
    <>
    <Modal
      visible={(!isAuthenticated && !registrationMode) || step !== "signin"}
      animationType="fade"
      transparent={true}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          style={styles.keyboardWrapper}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
        <View style={styles.container}>
          {step === "signin" && (
            <>
              <Text style={styles.title}>Welcome to s'up</Text>
              <Text style={styles.subtitle}>Sign in to continue</Text>

              <View style={styles.form}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="user@test.com"
                  placeholderTextColor="#A0A0A0"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}

                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter password"
                  placeholderTextColor="#A0A0A0"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
                {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

                <PressFeedback
                  onPress={() => {
                    setResetEmail(email);
                    setStep("forgot-email");
                  }}
                >
                  <Text style={styles.linkText}>Forgot password?</Text>
                </PressFeedback>

                <PressFeedback style={styles.button} onPress={handleSignIn}>
                  <Text style={styles.buttonText}>Sign In</Text>
                </PressFeedback>

                <PressFeedback
                  style={[styles.button, styles.secondaryButton]}
                  onPress={() => {
                    startRegistration();
                    router.push("/onboarding/intro" as any);
                  }}
                >
                  <Text style={[styles.buttonText, styles.secondaryText]}>Create account</Text>
                </PressFeedback>
              </View>
            </>
          )}

          {step === "forgot-email" && (
            <>
              <Text style={styles.title}>Reset password</Text>
              <Text style={styles.subtitle}>Enter your email and we'll send you a code</Text>

              <View style={styles.form}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="user@test.com"
                  placeholderTextColor="#A0A0A0"
                  value={resetEmail}
                  onChangeText={setResetEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                {resetError ? <Text style={styles.errorText}>{resetError}</Text> : null}

                <PressFeedback style={styles.button} onPress={handleSendResetCode} disabled={resetLoading}>
                  <Text style={styles.buttonText}>{resetLoading ? "Sending..." : "Send code"}</Text>
                </PressFeedback>

                <PressFeedback style={[styles.button, styles.secondaryButton]} onPress={resetToSignIn}>
                  <Text style={[styles.buttonText, styles.secondaryText]}>Back to sign in</Text>
                </PressFeedback>
              </View>
            </>
          )}

          {step === "forgot-code" && (
            <>
              <Text style={styles.title}>Check your email</Text>
              <Text style={[styles.subtitle, { marginBottom: 16 }]}>Enter the code we sent to {resetEmail}</Text>
              <Text style={styles.warningText}>💡 ensure that you check your spam/junk folder for the code!</Text>

              <View style={styles.form}>
                <Text style={styles.label}>Code</Text>
                <TextInput
                  style={styles.input}
                  placeholder="123456"
                  placeholderTextColor="#A0A0A0"
                  value={resetCode}
                  onChangeText={(v) => setResetCode(v.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                />
                {resetError ? <Text style={styles.errorText}>{resetError}</Text> : null}

                <PressFeedback style={styles.button} onPress={handleVerifyResetCode} disabled={resetLoading}>
                  <Text style={styles.buttonText}>{resetLoading ? "Verifying..." : "Verify code"}</Text>
                </PressFeedback>

                <PressFeedback style={[styles.button, styles.secondaryButton]} onPress={resetToSignIn}>
                  <Text style={[styles.buttonText, styles.secondaryText]}>Back to sign in</Text>
                </PressFeedback>
              </View>
            </>
          )}

          {step === "forgot-newpassword" && (
            <>
              <Text style={styles.title}>Set a new password</Text>
              <Text style={styles.subtitle}>Choose a new password for your account</Text>

              <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
                <Text style={styles.label}>New password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter new password"
                  placeholderTextColor="#A0A0A0"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                />

                <Text style={styles.label}>Confirm password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Confirm new password"
                  placeholderTextColor="#A0A0A0"
                  value={confirmNewPassword}
                  onChangeText={setConfirmNewPassword}
                  secureTextEntry
                />
                {resetError ? <Text style={styles.errorText}>{resetError}</Text> : null}

                <PressFeedback style={styles.button} onPress={handleSetNewPassword} disabled={resetLoading}>
                  <Text style={styles.buttonText}>{resetLoading ? "Saving..." : "Save new password"}</Text>
                </PressFeedback>
              </ScrollView>
            </>
          )}
        </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
    <BrandAlert
      visible={signInAlert !== null}
      title={signInAlert?.title ?? ""}
      message={signInAlert?.message}
      onRequestClose={() => setSignInAlert(null)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },

  keyboardWrapper: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  container: {
    backgroundColor: colours.background,
    borderRadius: 24,
    padding: 32,
    width: "85%",
    maxWidth: 400,
  },

  title: {
    fontSize: 22,
    fontWeight: "600",
    color: colours.textPrimary,
    textAlign: "center",
    marginBottom: 8,
    fontFamily: "Agrandir-GrandHeavy",
  },

  subtitle: {
    fontSize: 16,
    color: colours.textSecondary,
    textAlign: "center",
    marginBottom: 32,
    fontFamily: "Agrandir-Regular",
  },

  form: {
    width: "100%",
  },

  label: {
    fontSize: 14,
    fontWeight: "500",
    color: colours.textPrimary,
    marginBottom: 8,
    fontFamily: "Agrandir-Regular",
  },

  input: {
    backgroundColor: colours.card,
    borderWidth: 1,
    borderColor: colours.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colours.textPrimary,
    marginBottom: 20,
    fontFamily: "Agrandir-Regular",
  },

  button: {
    backgroundColor: colours.primary,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    marginTop: 8,
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Agrandir-Regular",
  },

  hint: {
    fontSize: 12,
    color: colours.textSecondary,
    textAlign: "center",
    marginTop: 16,
    fontFamily: "Agrandir-Regular",
  },
  warningText: {
    fontSize: 16,
    fontFamily: "Agrandir-Regular",
    fontWeight: "700",
    color: "#333",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 18,
  },
  errorText: {
    color: "#FF4D4F",
    marginBottom: 12,
    fontSize: 12,
    fontFamily: "Agrandir-Regular",
  },
  secondaryButton: {
    backgroundColor: colours.card,
    marginTop: 12,
  },
  secondaryText: {
    color: colours.textPrimary,
  },
  linkText: {
    color: colours.primary,
    fontSize: 14,
    fontFamily: "Agrandir-Regular",
    textAlign: "right",
    marginBottom: 8,
  },
});
