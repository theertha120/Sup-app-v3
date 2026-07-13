import React, { useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity, TextInput } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";

export default function DetailsScreen() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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

      <View style={styles.content}>
        <Text style={styles.heading}>almost there!</Text>
        <Text style={styles.subheading}>enter your details to reveal{"\n"}your s'upercluster</Text>

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

        <TouchableOpacity style={styles.nextBtn} onPress={() => router.push("/onboarding/final" as any)}>
          <Text style={styles.nextBtnText}>next</Text>
        </TouchableOpacity>
      </View>
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
    marginBottom: 12,
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
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  heading: {
    fontSize: 36,
    fontWeight: "900",
    color: "#111",
    marginBottom: 8,
    textAlign: "center",
  },
  subheading: {
    fontSize: 20,
    fontWeight: "500",
    color: "#111",
    lineHeight: 28,
    textAlign: "center",
    marginBottom: 24,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    padding: 24,
    width: "100%",
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
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
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
  },
});
