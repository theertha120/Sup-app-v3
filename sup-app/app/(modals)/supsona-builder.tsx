import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { colours } from "../../theme/colours";
import SupsonaAvatar from "../../src/components/supsona/SupsonaAvatar";
import { useToast } from "../../src/contexts/ToastContext";
import type {
  Supsona,
  FaceShapeId,
  HairStyleId,
  HairColourId,
  SkinToneId,
  ShirtColourId,
} from "../../src/components/supsona/supsona";
import {
  DEFAULT_SUPSONA,
  parseSupsona,
  stringifySupsona,
  FACE_SHAPES,
  HAIR_STYLES,
  HAIR_COLOURS,
  SKIN_TONES,
  SHIRT_COLOURS,
} from "../../src/components/supsona/supsona";
import {
  fetchCurrentUserProfileWithStats,
  updateCurrentUserProfile,
} from "../../src/services/user/profileService";

const OPTION_LABELS: Record<string, string> = {
  round: "Round",
  oval: "Oval",
  "soft-square": "Soft square",
  short: "Short",
  bob: "Bob",
  "long-straight": "Long",
  curly: "Curly",
  ponytail: "Ponytail",
  messy: "Messy",
  black: "Black",
  brown: "Brown",
  blonde: "Blonde",
  auburn: "Auburn",
  grey: "Grey",
  blue: "Blue",
  pink: "Pink",
  "warm-light": "Warm light",
  light: "Light",
  medium: "Medium",
  tan: "Tan",
  deep: "Deep",
  white: "White",
  navy: "Navy",
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  lavender: "Lavender",
  coral: "Coral",
};

export default function SupsonaBuilderScreen() {
  const { showToast } = useToast();
  const [supsona, setSupsona] = useState<Supsona>(DEFAULT_SUPSONA);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchCurrentUserProfileWithStats()
      .then((profile) => {
        const parsed = parseSupsona(profile.avatar);
        if (parsed) setSupsona(parsed);
      })
      .catch(() => setError("Could not load your profile"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await updateCurrentUserProfile({ avatar: stringifySupsona(supsona) });
      showToast("Supsona saved", "success");
      router.back();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save";
      setError(message);
      showToast("Could not save", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colours.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <Text style={styles.title}>Create your Supsona</Text>
        <Text style={styles.subtitle}>Customise your avatar</Text>
      </View>

      {/* Live preview */}
      <View style={styles.previewSection}>
        <View style={styles.previewCircle}>
          <SupsonaAvatar avatar={stringifySupsona(supsona)} size={160} />
        </View>
      </View>

      {/* Face shape */}
      <Section title="Face shape">
        {FACE_SHAPES.map((id) => (
          <OptionChip
            key={id}
            label={OPTION_LABELS[id] ?? id}
            selected={supsona.faceShape === id}
            onPress={() =>
              setSupsona((s) => ({ ...s, faceShape: id as FaceShapeId }))
            }
          />
        ))}
      </Section>

      {/* Hair style */}
      <Section title="Hair style">
        {HAIR_STYLES.map((id) => (
          <OptionChip
            key={id}
            label={OPTION_LABELS[id] ?? id}
            selected={supsona.hairStyle === id}
            onPress={() =>
              setSupsona((s) => ({ ...s, hairStyle: id as HairStyleId }))
            }
          />
        ))}
      </Section>

      {/* Hair colour */}
      <Section title="Hair colour">
        {HAIR_COLOURS.map((id) => (
          <OptionChip
            key={id}
            label={OPTION_LABELS[id] ?? id}
            selected={supsona.hairColour === id}
            onPress={() =>
              setSupsona((s) => ({ ...s, hairColour: id as HairColourId }))
            }
          />
        ))}
      </Section>

      {/* Skin tone */}
      <Section title="Skin tone">
        {SKIN_TONES.map((id) => (
          <OptionChip
            key={id}
            label={OPTION_LABELS[id] ?? id}
            selected={supsona.skinTone === id}
            onPress={() =>
              setSupsona((s) => ({ ...s, skinTone: id as SkinToneId }))
            }
          />
        ))}
      </Section>

      {/* Shirt colour */}
      <Section title="Shirt colour">
        {SHIRT_COLOURS.map((id) => (
          <OptionChip
            key={id}
            label={OPTION_LABELS[id] ?? id}
            selected={supsona.shirtColour === id}
            onPress={() =>
              setSupsona((s) => ({ ...s, shirtColour: id as ShirtColourId }))
            }
          />
        ))}
      </Section>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.saveButtonText}>Save Supsona</Text>
        )}
      </Pressable>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={sectionStyles.section}>
      <Text style={sectionStyles.title}>{title}</Text>
      <View style={sectionStyles.chips}>{children}</View>
    </View>
  );
}

function OptionChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[sectionStyles.chip, selected && sectionStyles.chipSelected]}
      onPress={onPress}
    >
      <Text
        style={[sectionStyles.chipText, selected && sectionStyles.chipTextSelected]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const sectionStyles = StyleSheet.create({
  section: { paddingHorizontal: 20, marginBottom: 24 },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: colours.textPrimary,
    marginBottom: 10,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: "#F0F0F0",
  },
  chipSelected: { backgroundColor: colours.primary },
  chipText: { fontSize: 14, color: colours.textSecondary },
  chipTextSelected: { color: "white", fontWeight: "600" },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colours.background },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "white",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  closeBtn: {
    position: "absolute",
    top: 52,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F0F0F0",
    justifyContent: "center",
    alignItems: "center",
  },
  closeText: { fontSize: 18, color: colours.textSecondary },
  title: { fontSize: 24, fontWeight: "700", color: colours.textPrimary },
  subtitle: { fontSize: 14, color: colours.textSecondary, marginTop: 4 },
  previewSection: {
    alignItems: "center",
    paddingVertical: 32,
  },
  previewCircle: {
    width: 176,
    height: 176,
    borderRadius: 88,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  errorText: {
    color: "#C00",
    textAlign: "center",
    marginHorizontal: 20,
    marginBottom: 8,
  },
  saveButton: {
    marginHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: colours.primary,
    alignItems: "center",
  },
  saveButtonDisabled: { opacity: 0.7 },
  saveButtonText: { color: "white", fontSize: 18, fontWeight: "600" },
});
