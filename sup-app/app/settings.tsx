import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Modal,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useState } from "react";
import { colours } from "../theme/colours";
import { useAuth } from "../src/contexts/AuthContext";
import { useToast } from "../src/contexts/ToastContext";
import {
  getSettingsSnapshot,
  updateSettings,
  type AppSettings,
} from "../src/services/user/settingsService";
import CoachingSetupModal from "../src/components/onboarding/CoachingSetupModal";
import {
  fetchCurrentBehaviorProfile,
  type BehaviorProfile,
} from "../src/services/user/behaviorProfileService";

export default function SettingsScreen() {
  const { logout } = useAuth();
  const { showToast } = useToast();
  const [settings, setSettings] = useState<AppSettings>(getSettingsSnapshot);
  const [showCoachingModal, setShowCoachingModal] = useState(false);
  const [initialBehaviorProfile, setInitialBehaviorProfile] = useState<BehaviorProfile | null>(null);
  const [loadingCoachingProfile, setLoadingCoachingProfile] = useState(false);
  // Theme and Units state
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [showUnitsModal, setShowUnitsModal] = useState(false);

  const updateSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
    options?: { toastMessage?: string }
  ) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      updateSettings({ [key]: value });
      return next;
    });

    if (options?.toastMessage) {
      showToast(options.toastMessage, "success");
    }
  };

  const handleLogout = () => {
    logout();
    router.replace("/home");
  };
  
  const getThemeLabel = () => {
    if (settings.theme === "light") return "Light";
    if (settings.theme === "dark") return "Dark";
    return "Auto";
  };
  
  const getUnitsLabel = () => {
    return settings.units === "metric" ? "Metric (cm, kg)" : "Imperial (in, lb)";
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
        
        <Pressable style={styles.settingItem} onPress={() => setShowThemeModal(true)}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Theme</Text>
            <Text style={styles.settingDescription}>{getThemeLabel()}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Sound Effects</Text>
            <Text style={styles.settingDescription}>
              Play sounds for actions
            </Text>
          </View>
          <Switch
            value={settings.soundEffectsEnabled}
            onValueChange={(value) => updateSetting("soundEffectsEnabled", value)}
            trackColor={{ false: "#E0E0E0", true: colours.primary }}
            thumbColor="white"
          />
        </View>

        <Pressable
          style={styles.settingItem}
          onPress={async () => {
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

        <Pressable style={styles.settingItem} onPress={() => setShowUnitsModal(true)}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Units</Text>
            <Text style={styles.settingDescription}>{getUnitsLabel()}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      {/* Data & Privacy Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data & Privacy</Text>
        
        <Pressable style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Privacy Policy</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <Pressable style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Terms of Service</Text>
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

        <Pressable style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Rate Us</Text>
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

      {/* Theme Selection Modal */}
      <Modal
        visible={showThemeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowThemeModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowThemeModal(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Theme</Text>
            
            <Pressable
              style={[styles.modalOption, settings.theme === "light" && styles.modalOptionSelected]}
              onPress={() => {
                updateSetting("theme", "light");
                setShowThemeModal(false);
              }}
            >
              <View style={styles.modalOptionTextContainer}>
                <Text style={[styles.modalOptionText, settings.theme === "light" && styles.modalOptionTextSelected]}>
                  ☀️  Light
                </Text>
              </View>
              {settings.theme === "light" && <Text style={styles.checkmark}>✓</Text>}
            </Pressable>

            <Pressable
              style={[styles.modalOption, settings.theme === "dark" && styles.modalOptionSelected]}
              onPress={() => {
                updateSetting("theme", "dark");
                setShowThemeModal(false);
              }}
            >
              <View style={styles.modalOptionTextContainer}>
                <Text style={[styles.modalOptionText, settings.theme === "dark" && styles.modalOptionTextSelected]}>
                  🌙  Dark
                </Text>
              </View>
              {settings.theme === "dark" && <Text style={styles.checkmark}>✓</Text>}
            </Pressable>

            <Pressable
              style={[styles.modalOption, settings.theme === "auto" && styles.modalOptionSelected]}
              onPress={() => {
                updateSetting("theme", "auto");
                setShowThemeModal(false);
              }}
            >
              <View style={styles.modalOptionTextContainer}>
                <Text style={[styles.modalOptionText, settings.theme === "auto" && styles.modalOptionTextSelected]}>
                  🔄  Auto (System)
                </Text>
              </View>
              {settings.theme === "auto" && <Text style={styles.checkmark}>✓</Text>}
            </Pressable>

            <Pressable
              style={styles.modalCancel}
              onPress={() => setShowThemeModal(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Units Selection Modal */}
      <Modal
        visible={showUnitsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUnitsModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowUnitsModal(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Units</Text>
            
            <Pressable
              style={[styles.modalOption, settings.units === "metric" && styles.modalOptionSelected]}
              onPress={() => {
                updateSetting("units", "metric");
                setShowUnitsModal(false);
              }}
            >
              <View>
                <Text style={[styles.modalOptionText, settings.units === "metric" && styles.modalOptionTextSelected]}>
                  Metric
                </Text>
                <Text style={styles.modalOptionSubtext}>Centimeters, Kilograms</Text>
              </View>
              {settings.units === "metric" && <Text style={styles.checkmark}>✓</Text>}
            </Pressable>

            <Pressable
              style={[styles.modalOption, settings.units === "imperial" && styles.modalOptionSelected]}
              onPress={() => {
                updateSetting("units", "imperial");
                setShowUnitsModal(false);
              }}
            >
              <View>
                <Text style={[styles.modalOptionText, settings.units === "imperial" && styles.modalOptionTextSelected]}>
                  Imperial
                </Text>
                <Text style={styles.modalOptionSubtext}>Inches, Pounds</Text>
              </View>
              {settings.units === "imperial" && <Text style={styles.checkmark}>✓</Text>}
            </Pressable>

            <Pressable
              style={styles.modalCancel}
              onPress={() => setShowUnitsModal(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Coaching setup modal (edit existing or create) */}
      <CoachingSetupModal
        key={showCoachingModal ? "open" : "closed"}
        visible={showCoachingModal}
        initialProfile={initialBehaviorProfile}
        onComplete={() => {
          setShowCoachingModal(false);
          showToast("Coaching preferences saved", "success");
        }}
        onSkip={() => {
          setShowCoachingModal(false);
          showToast("Using default coaching setup", "success");
        }}
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 20,
    width: "100%",
    maxWidth: 340,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#222",
    marginBottom: 16,
    textAlign: "center",
  },
  modalOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#F6F6FA",
    marginBottom: 10,
  },
  modalOptionSelected: {
    backgroundColor: colours.primary,
  },
  modalOptionTextContainer: {
    flex: 1,
  },
  modalOptionText: {
    fontSize: 16,
    color: "#222",
    fontWeight: "500",
  },
  modalOptionTextSelected: {
    color: "white",
  },
  modalOptionSubtext: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  checkmark: {
    fontSize: 20,
    color: "white",
    fontWeight: "700",
  },
  modalCancel: {
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },
  modalCancelText: {
    fontSize: 16,
    color: "#666",
    fontWeight: "600",
  },
  // for test notification button
  testButton: {
    backgroundColor: colours.primary,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  testButtonDisabled: {
    opacity: 0.6,
  },
  testButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },

});