import PressFeedback from "@/src/components/ui/PressFeedback";
import TutorialActions from "@/src/components/onboarding/TutorialActions";
import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
  TextInput,
  Image,
} from "react-native";
import { BrandAlert } from "./BrandAlert";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { displayName, normalizeUsername } from "@/src/utils/displayName";
import { useAuth } from "../../../src/contexts/AuthContext";
import {
  fetchCurrentUserProfileWithStats,
  subscribeToProfileUpdates,
  userProfileToUser,
  updateCurrentUserProfile,
  isUsernameTaken,
} from "../../../src/services/user/profileService";
import { useToast } from "../../../src/contexts/ToastContext";
import { useTutorial } from "../../../src/contexts/TutorialContext";
import { colours } from "../../../theme/colours";
import FriendsModal from "../modals/FriendsModal";
 
const PRIMARY_TEXT = "#1D014A";
const DROPDOWN_BG = "#FFFFFF";
const DIVIDER = "#CBCBF7";
const STREAK_COLOUR = "#EC555E";
// ── Header tour (last steps of the app tutorial) ─────────────────────────────
// Order: profile → settings → s'pot setup → streak, then the tutorial ends.
// `slot` is the icon's position counted from the RIGHT of the icon row
// (0 = profile, 1 = streak, 2 = s'pot setup, 3 = settings) — used to put the
// tip's caret under the right icon.
type HeaderTipStep = "add-friends-tip" | "header-settings-tip" | "header-sensor-tip" | "header-streak-tip";

const HEADER_TIPS: Record<HeaderTipStep, {
  text: string;
  slot: number;
  next: HeaderTipStep | null; // null = last tip, ends the tutorial
}> = {
  "add-friends-tip": {
    text: "tap your profile to add friends, see your average weekly points, edit your username or log out.",
    slot: 0,
    next: "header-settings-tip",
  },
  "header-settings-tip": {
    text: "settings - you can replay this tutorial here anytime.",
    slot: 3,
    next: "header-sensor-tip",
  },
  "header-sensor-tip": {
    text: "tap here to set up or check your s'pots.",
    slot: 2,
    next: "header-streak-tip",
  },
  "header-streak-tip": {
    text: "this is your streak. do sessions every day to keep it going!",
    slot: 1,
    next: null,
  },
};

// "Go to" prompts: the user opens the next page from the header themselves.
// Tapping the highlighted icon starts that page's tips.
type HeaderPromptStep = "go-settings-tip" | "go-sensor-tip";

const HEADER_PROMPTS: Record<HeaderPromptStep, { text: string; slot: number }> = {
  "go-settings-tip": {
    text: "now tap the settings icon up here to open your settings.",
    slot: 3,
  },
  "go-sensor-tip": {
    text: "now tap the s'pot icon up here to set up your s'pots.",
    slot: 2,
  },
};

const ICON_SIZE = 40; // styles.iconButton width
const ICON_GAP  = 8;  // styles.headerButtons gap
const CARET_SIZE = 14;
const caretRightFor = (slot: number) =>
  slot * (ICON_SIZE + ICON_GAP) + ICON_SIZE / 2 - CARET_SIZE / 2;

// Width / height of sup-logo-purple.png (539×253).
const LOGO_ASPECT_RATIO = 539 / 253;
 
interface HeaderBarProps {
  logoSize?: number;
}

export default function HeaderBar({ logoSize = 50 }: HeaderBarProps) {
  const router = useRouter();
  const { isAuthenticated, userId, streakVersion } = useAuth();
  const { showToast } = useToast();
  const { logout } = useAuth();
  const { tutorialStep, setTutorialStep, dismissTutorial } = useTutorial();
  const headerTip = tutorialStep && tutorialStep in HEADER_TIPS
    ? HEADER_TIPS[tutorialStep as HeaderTipStep]
    : null;
  const headerPrompt = tutorialStep && tutorialStep in HEADER_PROMPTS
    ? HEADER_PROMPTS[tutorialStep as HeaderPromptStep]
    : null;

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

  const [nameAlert, setNameAlert] = useState(false);
 
  // Load profile data
  const loadProfile = () => {
    fetchCurrentUserProfileWithStats()
      .then((profile: any) => {
        if (!profile) return;
        setUsername(displayName(profile, "you"));
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
  }, [isAuthenticated, streakVersion]);
 
  useEffect(() => {
    const unsubscribe = subscribeToProfileUpdates((updatedProfile) => {
      if (!userId || updatedProfile.id !== userId) return;
      const user = userProfileToUser(updatedProfile);
      setUsername(displayName(user, "you"));
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
      setNameAlert(true);
      return;
    }
    if (normalizeUsername(trimmed) !== normalizeUsername(username)) {
      if (await isUsernameTaken(trimmed)) {
        showToast("that username is taken, try another one", "error");
        return;
      }
    }
    try {
      const updatedProfile = await updateCurrentUserProfile({ username: trimmed });
      if (updatedProfile) {
        setUsername(displayName(userProfileToUser(updatedProfile), trimmed));
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
    if (tutorialStep === "go-settings-tip") setTutorialStep("settings-tip");
    router.push("/settings");
  };

  const handleSensorPress = () => {
    if (tutorialStep === "go-sensor-tip") setTutorialStep("connect-tip");
    router.push("/sensor-setup");
  };
 
  const handleOpenFriends = () => {
    closeDropdown();
    setFriendsModalVisible(true);
  };
 
  return (
    <>
      <View style={styles.topBar}>
        {/* Wordmark */}
        <Image
          source={require("../../../assets/images/sup-logo-purple.png")}
          style={{ height: logoSize, width: logoSize * LOGO_ASPECT_RATIO }}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="s'up"
        />
 
        {/* Icon row */}
        <View style={styles.headerButtons}>
 
          <PressFeedback
            style={[
              styles.iconButton,
              (tutorialStep === "header-settings-tip" || tutorialStep === "go-settings-tip") &&
                styles.iconButtonHighlighted,
            ]}
            onPress={handleSettingsPress}
          >
            <Ionicons name="settings-outline" size={22} color={PRIMARY_TEXT} />
          </PressFeedback>
 
          <PressFeedback
            style={[
              styles.iconButton,
              (tutorialStep === "header-sensor-tip" || tutorialStep === "go-sensor-tip") &&
                styles.iconButtonHighlighted,
            ]}
            onPress={handleSensorPress}
          >
            <Ionicons name="hardware-chip-outline" size={22} color={PRIMARY_TEXT} />
          </PressFeedback>
 
          {/* Streak badge — not pressable */}
          <View style={[
            styles.iconButton,
            styles.streakBadge,
            tutorialStep === "header-streak-tip" && styles.iconButtonHighlighted,
          ]}>
            <Ionicons name="flame" size={20} color={streakColor} />
            <Text style={[styles.streakCount, { color: streakColor }]}>
              {streakDays}
            </Text>
          </View>
 
          {/* Profile icon — measure position for dropdown */}
          <View ref={profileButtonRef} collapsable={false}>
            <PressFeedback
              style={[
                styles.iconButton,
                tutorialStep === "add-friends-tip" && styles.iconButtonHighlighted,
              ]}
              onPress={openDropdown}
            >
              <Ionicons name="person-circle-outline" size={22} color={PRIMARY_TEXT} />
            </PressFeedback>
          </View>
        </View>
      </View>

      {headerTip && (
        <View style={styles.tutorialTipAnchor}>
          <View style={[styles.tutorialTipCaret, { marginRight: caretRightFor(headerTip.slot) }]} />
          <View style={styles.tutorialTip}>
            <Image
              source={require("../../../assets/images/mascot_tutorial.png")}
              style={styles.tutorialTipMascot}
              resizeMode="contain"
            />
            <View style={styles.tutorialTipTextWrap}>
              <Text style={styles.tutorialTipText}>{headerTip.text}</Text>
              <TutorialActions>
                <PressFeedback
                  feedback="link"
                  onPress={() => headerTip.next ? setTutorialStep(headerTip.next) : dismissTutorial()}
                >
                  <Text style={styles.tutorialTipNext}>
                    {headerTip.next ? "next >>" : "start exploring the app!"}
                  </Text>
                </PressFeedback>
              </TutorialActions>
            </View>
          </View>
        </View>
      )}

      {headerPrompt && (
        <View style={styles.tutorialTipAnchor}>
          <View style={[styles.tutorialTipCaret, { marginRight: caretRightFor(headerPrompt.slot) }]} />
          <View style={styles.tutorialTip}>
            <Image
              source={require("../../../assets/images/mascot_tutorial.png")}
              style={styles.tutorialTipMascot}
              resizeMode="contain"
            />
            <View style={styles.tutorialTipTextWrap}>
              <Text style={styles.tutorialTipText}>{headerPrompt.text}</Text>
              <TutorialActions hideSkip />
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
                <PressFeedback style={styles.dropdownRow} onPress={handleEditUsername}>
                  <Text style={styles.dropdownUsername}>{username}</Text>
                  <Ionicons name="pencil-outline" size={15} color={PRIMARY_TEXT} />
                </PressFeedback>
 
                <View style={styles.divider} />
 
                {/* Weekly points */}
                <View style={styles.dropdownRow}>
                  <Text style={styles.dropdownLabel}>average weekly points</Text>
                  <Text style={styles.dropdownPoints}>{weeklyPoints}</Text>
                </View>
 
                <View style={styles.divider} />
 
                {/* Friends */}
                <PressFeedback style={styles.dropdownRow} onPress={handleOpenFriends}>
                  <Text style={styles.dropdownLabel}>friends</Text>
                  <Ionicons name="people-outline" size={18} color={PRIMARY_TEXT} />
                </PressFeedback>
 
                <View style={styles.divider} />
 
                {/* Log out */}
                <PressFeedback style={styles.dropdownRow} onPress={handleLogOut}>
                  <Text style={styles.dropdownLogout}>log out</Text>
                </PressFeedback>
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
                  <PressFeedback
                    style={styles.editCancel}
                    onPress={() => setEditingUsername(false)}
                  >
                    <Text style={styles.editCancelText}>cancel</Text>
                  </PressFeedback>
                  <PressFeedback style={styles.editSave} onPress={handleSaveUsername}>
                    <Text style={styles.editSaveText}>save</Text>
                  </PressFeedback>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <BrandAlert
        visible={nameAlert}
        title="username can't be empty"
        onRequestClose={() => setNameAlert(false)}
      />
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
    borderWidth: 3,
    borderColor: "transparent",
  },
  iconButtonHighlighted: {
    borderColor: "#5222AE",
    shadowColor: "#5222AE",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
  },

  /* Tutorial tip — anchored under the profile icon (last icon, right-aligned) */
  tutorialTipAnchor: {
    alignItems: "flex-end",
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  tutorialTipCaret: {
    width: CARET_SIZE,
    height: CARET_SIZE,
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
    fontSize: 15,
    color: "#FFFFFF",
    lineHeight: 20,
    marginBottom: 4,
  },
  tutorialTipNext: {
    fontFamily: "Agrandir-Regular",
    fontSize: 15,
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