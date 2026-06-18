import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Modal,
  Alert,
} from "react-native";
import { useState, useEffect } from "react";
import { colours } from "@/theme/colours";
import { useAuth } from "@/src/contexts/AuthContext";

export default function SignInModal() {
  const { isAuthenticated, login, register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Clear fields when modal becomes visible (after logout)
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

  function validatePassword(value: string): boolean {
    return value.length >= 8;
  }

  const handleSignIn = async () => {
    setEmailError(null);
    setPasswordError(null);

    if (!validateEmail(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }

    if (!validatePassword(password)) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }

    const res = await login(email, password);
    if (!res.success) {
      Alert.alert("Sign In Failed", res.error || "Invalid credentials. Please try again.");
    }
  };

  const handleRegister = async () => {
    setEmailError(null);
    setPasswordError(null);

    if (!validateEmail(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }

    if (!validatePassword(password)) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }

    const res = await register(email, password, name || undefined);
    if (!res.success) {
      Alert.alert("Registration Failed", res.error || "Could not create account. Try again.");
    }
  };

  return (
    <Modal
      visible={!isAuthenticated}
      animationType="fade"
      transparent={true}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>Welcome to S&apos;Up</Text>
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

            {isRegister && (
              <>
                <Text style={styles.label}>Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Your name"
                  placeholderTextColor="#A0A0A0"
                  value={name}
                  onChangeText={setName}
                />
              </>
            )}

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter password"
              placeholderTextColor="#A0A0A0"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            {passwordError ? (
              <Text style={[styles.errorText]}>{passwordError}</Text>
            ) : null}
            <Pressable
              style={styles.button}
              onPress={isRegister ? handleRegister : handleSignIn}
            >
              <Text style={styles.buttonText}>{isRegister ? "Register" : "Sign In"}</Text>
            </Pressable>

            <Pressable
              style={[styles.button, styles.secondaryButton]}
              onPress={() => setIsRegister((s) => !s)}
            >
              <Text style={[styles.buttonText, styles.secondaryText]}>
                {isRegister ? "Have an account? Sign In" : "Create account"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
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
    fontSize: 28,
    fontWeight: "600",
    color: colours.textPrimary,
    textAlign: "center",
    marginBottom: 8,
  },

  subtitle: {
    fontSize: 16,
    color: colours.textSecondary,
    textAlign: "center",
    marginBottom: 32,
  },

  form: {
    width: "100%",
  },

  label: {
    fontSize: 14,
    fontWeight: "500",
    color: colours.textPrimary,
    marginBottom: 8,
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
  },

  hint: {
    fontSize: 12,
    color: colours.textSecondary,
    textAlign: "center",
    marginTop: 16,
  },
  errorText: {
    color: "#FF4D4F",
    marginBottom: 12,
    fontSize: 12,
  },
  secondaryButton: {
    backgroundColor: colours.card,
    marginTop: 12,
  },
  secondaryText: {
    color: colours.textPrimary,
  },
});
