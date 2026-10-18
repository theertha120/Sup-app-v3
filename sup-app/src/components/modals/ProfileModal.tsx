import PressFeedback from "@/src/components/ui/PressFeedback";
import { useState, useEffect } from "react";
import {
  View,
  Text,
  Modal,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { colours } from "../../../theme/colours";
import type { User } from "../../../constants/env";
import { displayName, normalizeUsername } from "../../utils/displayName";
import {
  fetchUserProfile,
  updateUserProfile,
  isUsernameTaken,
  userProfileToUser,
  type ProfileUpdateInput,
} from "../../services/user/profileService";
import { UserSupsonaAvatar } from "../supsona/SupsonaAvatar";

interface ProfileModalProps {
  visible: boolean;
  user: User | null;
  isCurrentUser: boolean;
  onClose: () => void;
  onSave?: (updatedUser: User) => Promise<void>;
  loading?: boolean;
}

export default function ProfileModal({
  visible,
  user,
  isCurrentUser,
  onClose,
  onSave,
  loading: externalLoading,
}: ProfileModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [profileData, setProfileData] = useState<User | null>(user);

  // Sync with user when modal opens or when parent passes updated user (e.g. after supsona save)
  useEffect(() => {
    if (visible && user) {
      setProfileData(user);
    }
  }, [visible, user]);

  // Fetch full profile when modal opens for the first time for this user
  useEffect(() => {
    if (!visible || !user?.id) return;
    setIsLoading(true);
    fetchUserProfile(user.id)
      .then((profile) => {
        if (profile) setProfileData(userProfileToUser(profile));
      })
      .catch((err) => {
        console.error("[ProfileModal] Failed to fetch profile", err);
        setError("Failed to load profile data");
      })
      .finally(() => setIsLoading(false));
  }, [visible, user?.id]);

  const loading = externalLoading || isLoading;

  if (!visible) return null;

  const handleEdit = () => {
    if (!profileData) return;
    setEditedName(displayName(profileData));
    setError("");
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedName("");
    setError("");
  };

  const handleSave = async () => {
    if (!editedName.trim()) {
      setError("Username cannot be empty");
      return;
    }

    if (!profileData || !isCurrentUser) {
      setError("Cannot save: invalid user or not current user");
      return;
    }

    const nextHandle = editedName.trim();
    const currentHandle = displayName(profileData);
    if (normalizeUsername(nextHandle) !== normalizeUsername(currentHandle)) {
      if (await isUsernameTaken(nextHandle)) {
        setError("That username is taken, try another one");
        return;
      }
    }

    setIsSaving(true);
    setError("");

    try {
      const updates: ProfileUpdateInput = {
        username: nextHandle,
      };

      // Update via profileService
      const updatedProfile = await updateUserProfile(profileData.id, updates);

      if (!updatedProfile) {
        throw new Error("Update returned null");
      }

      const updatedUser = userProfileToUser(updatedProfile);
      setProfileData(updatedUser);

      // Call optional onSave callback for parent component updates
      if (onSave) {
        await onSave(updatedUser);
      }

      setIsEditing(false);
      setEditedName("");
    } catch (err) {
      console.error("[ProfileModal] Save error", err);
      setError(
        err instanceof Error ? err.message : "Failed to save changes. Please try again."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (isEditing) {
      handleCancel();
    }
    onClose();
  };

  // Get initials for avatar
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable style={styles.modal} onPress={(e) => e.stopPropagation()}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>
                {isEditing ? "Edit Profile" : "User Profile"}
              </Text>
              <PressFeedback onPress={handleClose} style={styles.closeButton}>
                <Text style={styles.closeText}>✕</Text>
              </PressFeedback>
            </View>

            {/* Avatar (Supsona or default initials) */}
            <View style={styles.avatarContainer}>
              <UserSupsonaAvatar
                avatar={profileData?.avatar}
                name={
                  isEditing
                    ? editedName || displayName(profileData)
                    : displayName(profileData)
                }
                size={80}
                style={styles.avatarLarge}
                textStyle={styles.avatarLargeText}
              />
            </View>

            {/* User Info */}
            <View style={styles.content}>
              {loading ? (
                <View style={{ padding: 24, alignItems: "center" }}>
                  <ActivityIndicator size="large" color={colours.primary} />
                </View>
              ) : (
                <>
                  {isEditing ? (
                    <>
                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>Username</Text>
                        <TextInput
                          style={styles.input}
                          value={editedName}
                          onChangeText={setEditedName}
                          placeholder="Enter your username"
                          placeholderTextColor="#999"
                        />
                      </View>

                      {error && (
                        <View style={styles.errorContainer}>
                          <Text style={styles.errorText}>{error}</Text>
                        </View>
                      )}
                    </>
                  ) : (
                    <>
                      <Text style={styles.name}>{displayName(profileData) || "Loading..."}</Text>
                      {isCurrentUser && (
                        <PressFeedback
                          style={styles.supsonaButton}
                          onPress={() => {
                            onClose();
                            router.push("/supsona-builder");
                          }}
                        >
                          <Text style={styles.supsonaButtonText}>Customise Supsona</Text>
                        </PressFeedback>
                      )}
                    </>
                  )}

                  {/* Stats */}
                  {profileData && (
                    <View style={styles.statsContainer}>
                      <View style={styles.statBox}>
                        <Text style={styles.statValue}>{profileData.currentStreak ?? 0}</Text>
                        <Text style={styles.statLabel}>
                          {(profileData.currentStreak ?? 0) === 1 ? "Day" : "Days"} Streak
                        </Text>
                      </View>

                      <View style={styles.statBox}>
                        <Text style={styles.statValue}>{profileData.weeklyAvgPoints ?? 0}</Text>
                        <Text style={styles.statLabel}>Weekly Points</Text>
                      </View>
                    </View>
                  )}
                </>
              )}
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              {isEditing ? (
                <>
                  <PressFeedback
                    style={[styles.button, styles.buttonSecondary]}
                    onPress={handleCancel}
                    disabled={isSaving}
                  >
                    <Text style={styles.buttonTextSecondary}>Cancel</Text>
                  </PressFeedback>

                  <PressFeedback
                    style={[
                      styles.button,
                      styles.buttonPrimary,
                      isSaving && styles.buttonDisabled,
                    ]}
                    onPress={handleSave}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <Text style={styles.buttonTextPrimary}>Save</Text>
                    )}
                  </PressFeedback>
                </>
              ) : (
                <>
                  {isCurrentUser && (
                    <PressFeedback
                      style={[styles.button, styles.buttonPrimary]}
                      onPress={handleEdit}
                    >
                      <Text style={styles.buttonTextPrimary}>Edit Profile</Text>
                    </PressFeedback>
                  )}
                </>
              )}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modal: {
    backgroundColor: "white",
    borderRadius: 24,
    width: "100%",
    maxWidth: 400,
    maxHeight: "80%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: "#222",
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F6F6FA",
    justifyContent: "center",
    alignItems: "center",
  },
  closeText: {
    fontSize: 18,
    color: "#666",
  },
  avatarContainer: {
    alignItems: "center",
    paddingVertical: 24,
  },
  avatarLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colours.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarLargeText: {
    color: "white",
    fontSize: 28,
    fontWeight: "600",
  },
  supsonaButton: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colours.primarySoft,
    alignSelf: "center",
  },
  supsonaButtonText: {
    color: colours.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  content: {
    padding: 20,
  },
  name: {
    fontSize: 22,
    fontWeight: "700",
    color: colours.textPrimary,
    textAlign: "center",
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 24,
    gap: 16,
  },
  statBox: {
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    backgroundColor: colours.card,
    minWidth: 120,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "700",
    color: colours.primary,
  },
  statLabel: {
    fontSize: 12,
    color: colours.textSecondary,
    marginTop: 4,
  },
  actions: {
    padding: 20,
    paddingTop: 0,
    gap: 12,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  buttonPrimary: {
    backgroundColor: colours.primary,
  },
  buttonSecondary: {
    backgroundColor: "#F0F0F0",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonTextPrimary: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonTextSecondary: {
    color: "#555",
    fontSize: 16,
    fontWeight: "600",
  },
  inputGroup: {
    marginTop: 8,
  },
  label: {
    fontSize: 13,
    color: colours.textSecondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colours.card,
    borderWidth: 1,
    borderColor: colours.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colours.textPrimary,
  },
  errorContainer: {
    marginTop: 10,
    backgroundColor: "#FDECEC",
    borderRadius: 10,
    padding: 10,
  },
  errorText: {
    color: "#C00",
    fontSize: 13,
    textAlign: "center",
  },
});
