import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
  Linking,
} from "react-native";
import { router } from "expo-router";
import { useState } from "react";
import { colours } from "../theme/colours";
import { useAuth } from "../src/contexts/AuthContext";
import { useToast } from "../src/contexts/ToastContext";
import CoachingSetupModal from "../src/components/onboarding/CoachingSetupModal";
import {
  fetchCurrentBehaviorProfile,
  type BehaviorProfile,
} from "../src/services/user/behaviorProfileService";

import { useTutorial } from "@/src/contexts/TutorialContext";
import React from "react";

const PRIVACY_POLICY_URL = "https://www.termsfeed.com/live/3d4b8e6c-82de-4104-a866-e52e4377ada4";

export default function SettingsScreen() {
  const { logout } = useAuth();
  const { showToast } = useToast();
  const { tutorialStep, setTutorialStep } = useTutorial();
  const [showCoachingModal, setShowCoachingModal] = useState(false);
  const [initialBehaviorProfile, setInitialBehaviorProfile] = useState<BehaviorProfile | null>(null);
  const [loadingCoachingProfile, setLoadingCoachingProfile] = useState(false);

  const handleLogout = () => {
    logout();
    router.replace("/home");
  };


  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Preferences Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Preferences</Text>

        {tutorialStep === "settings-tip" && (
          <View style={styles.tutorialTip}>
            <Image
              source={require("../assets/images/mascot.png")}
              style={styles.tutorialTipMascot}
              resizeMode="contain"
            />
            <View style={styles.tutorialTipTextWrap}>
              <Text style={styles.tutorialTipText}>click here to set your coaching preferences.</Text>
            </View>
          </View>
        )}

        <Pressable
          style={styles.settingItem}
          onPress={async () => {
            if (tutorialStep === "settings-tip") setTutorialStep("coaching-tip");
            setLoadingCoachingProfile(true);
            try {
              const profile = await fetchCurrentBehaviorProfile();
              setInitialBehaviorProfile(profile);
            } catch {
              setInitialBehaviorProfile(null);
            } finally {
              setLoadingCoachingProfile(false);
              setShowCoachingModal(true);
            }
          }}
        >
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Coaching preferences</Text>
            <Text style={styles.settingDescription}>Edit reminders, goals and active hours</Text>
          </View>
          {loadingCoachingProfile
            ? <ActivityIndicator size="small" color={colours.primary} />
            : <Text style={styles.chevron}>›</Text>
          }
        </Pressable>

      </View>

      {/* Data & Privacy Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data & Privacy</Text>
        
        <Pressable style={styles.settingItem} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Privacy Policy</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        
        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>App Version</Text>
          </View>
          <Text style={styles.settingValue}>1.0.0</Text>
        </View>

        <Pressable style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Help & Support</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      {/* Help Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Help</Text>

        <Pressable
          style={styles.settingItem}
          onPress={() => {
            router.replace("/(tabs)/home" as any);
            router.push("/tutorial/intro" as any);
          }}
        >
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Run tutorial again</Text>
            <Text style={styles.settingDescription}>Replay the app walkthrough</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      {/* Logout Section */}
      <View style={styles.section}>
        <Pressable style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </View>

      {/* Footer space */}
      <View style={{ height: 40 }} />

      {/* Coaching setup modal (edit existing or create) */}
      <CoachingSetupModal
        key={showCoachingModal ? "open" : "closed"}
        visible={showCoachingModal}
        initialProfile={initialBehaviorProfile}
        onComplete={() => {
          setShowCoachingModal(false);
          showToast("Coaching preferences saved", "success");
          if (tutorialStep === "coaching-tip") {
            setTutorialStep("connect-tip");
            router.push("/sensor-setup" as any);
          }
        }}
        onCancel={() => setShowCoachingModal(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F6F6FA",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  backIcon: {
    fontSize: 24,
    color: "#222",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#222",
  },
  placeholder: {
    width: 40,
  },
  section: {
    backgroundColor: "white",
    marginTop: 20,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#999",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingTop: 16,
    paddingBottom: 8,
  },
  settingItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F6F6FA",
  },
  tutorialTip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(30, 24, 46, 0.94)",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  tutorialTipMascot: {
    width: 34,
    height: 34,
  },
  tutorialTipTextWrap: {
    flex: 1,
  },
  tutorialTipText: {
    fontSize: 13,
    color: "#FFFFFF",
    lineHeight: 18,
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    color: "#222",
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 13,
    color: "#999",
  },
  settingValue: {
    fontSize: 14,
    color: "#999",
  },
  chevron: {
    fontSize: 24,
    color: "#CCC",
    marginLeft: 12,
  },
  deviceStatus: {
    fontSize: 18,
    color: "#4CAF50",
    marginLeft: 12,
  },
  logoutButton: {
    backgroundColor: "#FEE",
    marginVertical: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FDD",
  },
  logoutText: {
    color: "#C00",
    fontSize: 16,
    fontWeight: "600",
  },
});