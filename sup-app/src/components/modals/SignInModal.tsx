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
  const { isAuthenticated, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Clear fields when modal becomes visible (after logout)
  useEffect(() => {
    if (!isAuthenticated) {
      setEmail("");
      setPassword("");
    }
  }, [isAuthenticated]);

  const handleSignIn = () => {
    if (!email || !password) {
      Alert.alert("Error", "Please enter both email and password");
      return;
    }

    const success = login(email, password);
    if (!success) {
      Alert.alert("Sign In Failed", "Invalid credentials. Please try again.");
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

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter password"
              placeholderTextColor="#A0A0A0"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <Pressable style={styles.button} onPress={handleSignIn}>
              <Text style={styles.buttonText}>Sign In</Text>
            </Pressable>

            <Text style={styles.hint}>
              For testing: Use user@test.com with password 1234 :)
            </Text>
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
});
