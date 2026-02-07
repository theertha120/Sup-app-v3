import { useState } from "react";
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
import { colours } from "../../theme/colours";
import type { User } from "../../constants/env";

interface ProfileModalProps {
  visible: boolean;
  user: User | null;
  isCurrentUser: boolean;
  onClose: () => void;
  onSave: (updatedUser: { name: string; avatar?: string }) => Promise<void>;
}

export default function ProfileModal({
  visible,
  user,
  isCurrentUser,
  onClose,
  onSave,
}: ProfileModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedAvatar, setEditedAvatar] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  if (!user) return null;

  const handleEdit = () => {
    setEditedName(user.name);
    setEditedAvatar(user.avatar || "");
    setError("");
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedName("");
    setEditedAvatar("");
    setError("");
  };

  const handleSave = async () => {
    if (!editedName.trim()) {
      setError("Name cannot be empty");
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      await onSave({
        name: editedName.trim(),
        avatar: editedAvatar.trim() || undefined,
      });
      setIsEditing(false);
      setEditedName("");
      setEditedAvatar("");
    } catch (err) {
      setError("Failed to save changes. Please try again.");
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
              <Pressable onPress={handleClose} style={styles.closeButton}>
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>

            {/* Avatar */}
            <View style={styles.avatarContainer}>
              <View style={styles.avatarLarge}>
                <Text style={styles.avatarLargeText}>
                  {getInitials(isEditing ? editedName || user.name : user.name)}
                </Text>
              </View>
            </View>

            {/* User Info */}
            <View style={styles.content}>
              {isEditing ? (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Display Name</Text>
                    <TextInput
                      style={styles.input}
                      value={editedName}
                      onChangeText={setEditedName}
                      placeholder="Enter your name"
                      placeholderTextColor="#999"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Avatar URL (optional)</Text>
                    <TextInput
                      style={styles.input}
                      value={editedAvatar}
                      onChangeText={setEditedAvatar}
                      placeholder="https://example.com/avatar.jpg"
                      placeholderTextColor="#999"
                      autoCapitalize="none"
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
                  <Text style={styles.name}>{user.name}</Text>
                  {user.avatar && (
                    <Text style={styles.avatarUrl}>Avatar: {user.avatar}</Text>
                  )}
                </>
              )}

              {/* Stats */}
              <View style={styles.statsContainer}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{user.currentStreak}</Text>
                  <Text style={styles.statLabel}>
                    {user.currentStreak === 1 ? "Day" : "Days"} Streak
                  </Text>
                </View>

                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{user.weeklyTotalPoints}</Text>
                  <Text style={styles.statLabel}>Weekly Points</Text>
                </View>
              </View>
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              {isEditing ? (
                <>
                  <Pressable
                    style={[styles.button, styles.buttonSecondary]}
                    onPress={handleCancel}
                    disabled={isSaving}
                  >
                    <Text style={styles.buttonTextSecondary}>Cancel</Text>
                  </Pressable>

                  <Pressable
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
                  </Pressable>
                </>
              ) : (
                <>
                  {isCurrentUser && (
                    <Pressable
                      style={[styles.button, styles.buttonPrimary]}
                      onPress={handleEdit}
                    >
                      <Text style={styles.buttonTextPrimary}>Edit Profile</Text>
                    </Pressable>
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
  content: {
    padding: 20,
    paddingTop: 0,
  },
  name: {
    fontSize: 24,
    fontWeight: "600",
    color: "#222",
    textAlign: "center",
    marginBottom: 8,
  },
  avatarUrl: {
    fontSize: 12,
    color: "#999",
    textAlign: "center",
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#F6F6FA",
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: "#222",
  },
  errorContainer: {
    backgroundColor: "#FEE",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    color: "#C00",
    fontSize: 14,
  },
  statsContainer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  statBox: {
    flex: 1,
    backgroundColor: "#F6F6FA",
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
  },
  statValue: {
    fontSize: 24,
    fontWeight: "700",
    color: colours.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    padding: 20,
    paddingTop: 0,
  },
  button: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  buttonPrimary: {
    backgroundColor: colours.primary,
  },
  buttonSecondary: {
    backgroundColor: "#F6F6FA",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonTextPrimary: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonTextSecondary: {
    color: "#666",
    fontSize: 16,
    fontWeight: "600",
  },
});
