import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
  TextInput,
  Alert,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "../../../src/contexts/AuthContext";
import {
  fetchCurrentUserProfileWithStats,
  subscribeToProfileUpdates,
  userProfileToUser,
  updateCurrentUserProfile,
} from "../../../src/services/user/profileService";
import { useToast } from "../../../src/contexts/ToastContext";
import { useTutorial } from "../../../src/contexts/TutorialContext";
import { colours } from "../../../theme/colours";
import FriendsModal from "../modals/FriendsModal";
 
const PRIMARY_TEXT = "#1D014A";
const DROPDOWN_BG = "#FFFFFF";
const DIVIDER = "#CBCBF7";
const STREAK_COLOUR = "#EC555E";
 
interface HeaderBarProps {
  suffix?: string;
  logoSize?: number;
}
 
export default function HeaderBar({ suffix = "up", logoSize = 50 }: HeaderBarProps) {
  const router = useRouter();
  const { isAuthenticated, userId } = useAuth();
  const { showToast } = useToast();
  const { logout } = useAuth();
  const { tutorialStep, dismissTutorial } = useTutorial();
 
  const [streakDays, setStreakDays] = useState(0);
  const [weeklyPoints, setWeeklyPoints] = useState(0);
  const [username, setUsername] = useState("you");
 
  // Profile dropdown
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const profileButtonRef = useRef<View>(null);
  const [dropdownY, setDropdownY] = useState(0);
  const [dropdownX, setDropdownX] = useState(0);
 
  // Username edit modal
  const [editingUsername, setEditingUsername] = useState(false);
  const [draftName, setDraftName] = useState(username);
 
  // Friends modal
  const [friendsModalVisible, setFriendsModalVisible] = useState(false);
 
  // Load profile data
  const loadProfile = () => {
    fetchCurrentUserProfileWithStats()
      .then((profile: any) => {
        if (!profile) return;
        setUsername(profile.name ?? "you");
        setStreakDays(profile.currentStreak ?? 0);
        setWeeklyPoints(profile.weeklyAvgPoints ?? 0);
      })
      .catch((err: any) => {
        console.error("[HeaderBar] Failed to load profile", err);
      });
  };
 
  useEffect(() => {
    if (!isAuthenticated) {
      setUsername("you");
      setStreakDays(0);
      setWeeklyPoints(0);
      return;
    }
    loadProfile();
  }, [isAuthenticated]);
 
  useEffect(() => {
    const unsubscribe = subscribeToProfileUpdates((updatedProfile) => {
      if (!userId || updatedProfile.id !== userId) return;
      const user = userProfileToUser(updatedProfile);
      setUsername(user.name ?? "you");
    });
    return unsubscribe;
  }, [userId]);
 
  const streakActive = streakDays > 1;
  const streakColor = streakActive ? STREAK_COLOUR : PRIMARY_TEXT;
 
  const openDropdown = () => {
    profileButtonRef.current?.measure((_fx, _fy, _w, _h, px, py) => {
      setDropdownX(px);
      setDropdownY(py + _h + 4);
      setDropdownVisible(true);
    });
  };
 
  const closeDropdown = () => setDropdownVisible(false);
 
  const handleEditUsername = () => {
    setDraftName(username);
    setEditingUsername(true);
    closeDropdown();
  };
 
  const handleSaveUsername = async () => {
    const trimmed = draftName.trim();
    if (trimmed.length === 0) {
      Alert.alert("Username can't be empty");
      return;
    }
    try {
      const updatedProfile = await updateCurrentUserProfile({ name: trimmed });
      if (updatedProfile) {
        setUsername(userProfileToUser(updatedProfile).name ?? trimmed);
      }
      showToast("username updated", "success");
    } catch (err) {
      console.error("[HeaderBar] Failed to update username", err);
      showToast("couldn't update username, try again", "error");
    }
    setEditingUsername(false);
  };
 
  const handleLogOut = () => {
    closeDropdown();
    logout();
    router.replace("/home");
  };
 
  const handleSettingsPress = () => {
    router.push("/settings");
  };
 
  const handleOpenFriends = () => {
    closeDropdown();
    setFriendsModalVisible(true);
  };
 
  return (
    <>
      <View style={styles.topBar}>
        {/* Wordmark */}
        <Text style={[styles.logo, { fontSize: logoSize }]}>
          s<Text style={styles.logoApostrophe}>'</Text>{suffix}
        </Text>
 
        {/* Icon row */}
        <View style={styles.headerButtons}>
 
          <Pressable style={styles.iconButton} onPress={handleSettingsPress}>
            <Ionicons name="settings-outline" size={22} color={PRIMARY_TEXT} />
          </Pressable>
 
          <Pressable
            style={styles.iconButton}
            onPress={() => router.push("/sensor-setup")}
          >
            <Ionicons name="hardware-chip-outline" size={22} color={PRIMARY_TEXT} />
          </Pressable>
 
          {/* Streak badge — not pressable */}
          <View style={[styles.iconButton, styles.streakBadge]}>
            <Ionicons name="flame" size={20} color={streakColor} />
            <Text style={[styles.streakCount, { color: streakColor }]}>
              {streakDays}
            </Text>
          </View>
 
          {/* Profile icon — measure position for dropdown */}
          <View ref={profileButtonRef} collapsable={false}>
            <Pressable style={styles.iconButton} onPress={openDropdown}>
              <Ionicons name="person-circle-outline" size={22} color={PRIMARY_TEXT} />
            </Pressable>
          </View>
        </View>
      </View>

      {tutorialStep === "add-friends-tip" && (
        <View style={styles.tutorialTipAnchor}>
          <View style={styles.tutorialTipCaret} />
          <View style={styles.tutorialTip}>
            <Image
              source={require("../../../assets/images/mascot.png")}
              style={styles.tutorialTipMascot}
              resizeMode="contain"
            />
            <View style={styles.tutorialTipTextWrap}>
              <Text style={styles.tutorialTipText}>
                tap the profile icon at the headerbar and pick 'friends' to search for people and add them.
              </Text>
              <Pressable onPress={dismissTutorial}>
                <Text style={styles.tutorialTipNext}>got it!</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* ── Profile dropdown ── */}
      <Modal
        visible={dropdownVisible}
        transparent
        animationType="fade"
        onRequestClose={closeDropdown}
      >
        <TouchableWithoutFeedback onPress={closeDropdown}>
          <View style={StyleSheet.absoluteFill}>
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.dropdown,
                  { top: dropdownY, right: 16 }, // right-align to screen edge
                ]}
              >
                {/* Username row */}
                <Pressable style={styles.dropdownRow} onPress={handleEditUsername}>
                  <Text style={styles.dropdownUsername}>{username}</Text>
                  <Ionicons name="pencil-outline" size={15} color={PRIMARY_TEXT} />
                </Pressable>
 
                <View style={styles.divider} />
 
                {/* Weekly points */}
                <View style={styles.dropdownRow}>
                  <Text style={styles.dropdownLabel}>average weekly points</Text>
                  <Text style={styles.dropdownPoints}>{weeklyPoints}</Text>
                </View>
 
                <View style={styles.divider} />
 
                {/* Friends */}
                <Pressable style={styles.dropdownRow} onPress={handleOpenFriends}>
                  <Text style={styles.dropdownLabel}>friends</Text>
                  <Ionicons name="people-outline" size={18} color={PRIMARY_TEXT} />
                </Pressable>
 
                <View style={styles.divider} />
 
                {/* Log out */}
                <Pressable style={styles.dropdownRow} onPress={handleLogOut}>
                  <Text style={styles.dropdownLogout}>log out</Text>
                </Pressable>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
 
      {/* ── Friends modal (search / requests / friends list) ── */}
      <FriendsModal
        visible={friendsModalVisible}
        onClose={() => setFriendsModalVisible(false)}
        currentUserId={userId ?? null}
      />
 
      {/* ── Username edit modal ── */}
      <Modal
        visible={editingUsername}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingUsername(false)}
      >
        <TouchableWithoutFeedback onPress={() => setEditingUsername(false)}>
          <View style={styles.editOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.editCard}>
                <Text style={styles.editTitle}>edit username</Text>
                <TextInput
                  style={styles.editInput}
                  value={draftName}
                  onChangeText={setDraftName}
                  autoFocus
                  selectTextOnFocus
                  placeholder="your name"
                  placeholderTextColor="#CBCBF7"
                  maxLength={30}
                />
                <View style={styles.editActions}>
                  <Pressable
                    style={styles.editCancel}
                    onPress={() => setEditingUsername(false)}
                  >
                    <Text style={styles.editCancelText}>cancel</Text>
                  </Pressable>
                  <Pressable style={styles.editSave} onPress={handleSaveUsername}>
                    <Text style={styles.editSaveText}>save</Text>
                  </Pressable>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 56,
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  logo: {
    color: PRIMARY_TEXT,
    fontFamily: "Agrandir-GrandHeavy",
    fontSize: 50,
  },
  logoApostrophe: {
    fontFamily: "Arial",
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
  },

  /* Tutorial tip — anchored under the profile icon (last icon, right-aligned) */
  tutorialTipAnchor: {
    alignItems: "flex-end",
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  tutorialTipCaret: {
    width: 14,
    height: 14,
    marginRight: 12,
    marginBottom: -7,
    backgroundColor: "rgba(30, 24, 46, 0.94)",
    borderRadius: 3,
    transform: [{ rotate: "45deg" }],
  },
  tutorialTip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: 260,
    backgroundColor: "rgba(30, 24, 46, 0.94)",
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
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
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    color: "#FFFFFF",
    lineHeight: 18,
    marginBottom: 4,
  },
  tutorialTipNext: {
    fontFamily: "Agrandir-Regular",
    fontSize: 13,
    fontWeight: "700",
    color: colours.primary,
    textDecorationLine: "underline",
  },

  dropdown: {
    position: "absolute",
    minWidth: 200,
    backgroundColor: DROPDOWN_BG,
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: "#1D014A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  dropdownRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 10,
  },
  dropdownUsername: {
    fontSize: 15,
    fontWeight: "600",
    color: PRIMARY_TEXT,
    flex: 1,
  },
  dropdownLabel: {
    fontSize: 14,
    color: "#1D014A",
    flex: 1,
  },
  dropdownPoints: {
    fontSize: 14,
    fontWeight: "700",
    color: PRIMARY_TEXT,
  },
  dropdownLogout: {
    fontSize: 14,
    color: "#CC0F55",
    fontWeight: "500",
  },
  divider: {
    height: 1,
    backgroundColor: DIVIDER,
    marginHorizontal: 12,
  },
 
  // Edit modal
  editOverlay: {
    flex: 1,
    backgroundColor: "rgba(63,36,131,0.18)",
    justifyContent: "center",
    alignItems: "center",
  },
  editCard: {
    backgroundColor: DROPDOWN_BG,
    borderRadius: 18,
    padding: 24,
    width: 300,
    shadowColor: "#1D014A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  editTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: PRIMARY_TEXT,
    marginBottom: 14,
  },
  editInput: {
    borderWidth: 1.5,
    borderColor: "#1D014A",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: PRIMARY_TEXT,
    marginBottom: 18,
  },
  editActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  editCancel: {
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  editCancelText: {
    fontSize: 14,
    color: "#1D014A",
  },
  editSave: {
    backgroundColor: PRIMARY_TEXT,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 9,
  },
  editSaveText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 2,
  },
  streakCount: {
    fontSize: 14,
    fontWeight: "700",
  },
});