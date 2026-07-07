import React, { useState, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
 
const PRIMARY_TEXT = "#1D014A";
const DROPDOWN_BG = "#FFFFFF";
const DIVIDER = "#CBCBF7";
const STREAK_COLOUR = "#EC555E";
 
interface HeaderBarProps {
  onSettingsPress?: () => void;
  /** Number of consecutive active days; drives streak badge colour */
  streakDays?: number;
  /** Username shown in the profile dropdown */
  username?: string;
  /** Called with the new username when the user saves an edit */
  onUsernameChange?: (newName: string) => void;
  /** Called when the user taps Log Out */
  onLogOut?: () => void;
  /** Weekly points total shown in the dropdown */
  weeklyPoints?: number;
}
 
export default function HeaderBar({
  onSettingsPress,
  streakDays = 0,
  username = "you",
  onUsernameChange,
  onLogOut,
  weeklyPoints = 0,
}: HeaderBarProps) {
  const router = useRouter();

  const streakActive = streakDays > 1;
  const streakColor = streakActive ? STREAK_COLOUR : PRIMARY_TEXT;
 
  // Profile dropdown
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const profileButtonRef = useRef<View>(null);
  const [dropdownY, setDropdownY] = useState(0);
  const [dropdownX, setDropdownX] = useState(0);
 
  // Username edit modal
  const [editingUsername, setEditingUsername] = useState(false);
  const [draftName, setDraftName] = useState(username);
 
  const openDropdown = () => {
    profileButtonRef.current?.measure((_fx, _fy, _w, _h, px, py) => {
      // Anchor dropdown below and right-aligned to the icon
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
 
  const handleSaveUsername = () => {
    const trimmed = draftName.trim();
    if (trimmed.length === 0) {
      Alert.alert("Username can't be empty");
      return;
    }
    onUsernameChange?.(trimmed);
    setEditingUsername(false);
  };
 
  const handleLogOut = () => {
    closeDropdown();
    onLogOut?.();
  };
 
  return (
    <>
      <View style={styles.topBar}>
        {/* Wordmark */}
        <Text style={styles.logo}>
          s<Text style={styles.logoApostrophe}>'</Text>up
        </Text>
 
        {/* Icon row */}
        <View style={styles.headerButtons}>

          <Pressable style={styles.iconButton} onPress={onSettingsPress}>
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
                  <Text style={styles.dropdownLabel}>weekly points</Text>
                  <Text style={styles.dropdownPoints}>{weeklyPoints}</Text>
                </View>
 
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