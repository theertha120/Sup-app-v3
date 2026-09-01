/**
 * InfoModal.tsx
 *
 * Shared "?" button + info popup used anywhere the app explains a metric to
 * the user (s'napshot, s'core, s'train, etc.) — extracted from what was a
 * locally-duplicated pattern in daily.tsx so it can be reused (desk.tsx's
 * s'train explainer) with one shared behaviour: every popup this renders
 * includes a "view sources & methodology" link to the full explanation
 * page, per the requirement that all metric explanations be traceable back
 * to it — see app/sources-methodology.tsx.
 */

import React from "react";
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback,
} from "react-native";
import { router } from "expo-router";
import { colours } from "../../../theme/colours";

export interface InfoModalEntry {
  title: string;
  body: string;
  stats?: { label: string; value: string; color?: string }[];
}

/** Tiny "?" button — absolutely positioned in the top-right of its parent by default. */
export function InfoButton({
  onPress,
  color = colours.primary,
  style,
}: {
  onPress: () => void;
  color?: string;
  style?: object;
}) {
  return (
    <TouchableOpacity
      style={[s.button, { backgroundColor: `${color}26` }, style]}
      onPress={onPress}
      hitSlop={8}
    >
      <Text style={[s.buttonLabel, { color }]}>?</Text>
    </TouchableOpacity>
  );
}

/** Info popup modal — title + body + optional stat rows + a link to the full sources page. */
export function InfoModal({
  metricKey,
  onClose,
  metricInfo,
  accentColor = colours.primary,
}: {
  metricKey: string | null;
  onClose: () => void;
  metricInfo: Record<string, InfoModalEntry>;
  accentColor?: string;
}) {
  if (!metricKey) return null;
  const info = metricInfo[metricKey];
  if (!info) return null;

  const openSources = () => {
    onClose();
    router.push("/sources-methodology" as any);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.overlay}>
          <TouchableWithoutFeedback>
            <View style={s.sheet}>
              <Text style={[s.title, { color: accentColor }]}>{info.title}</Text>
              <Text style={s.body}>{info.body}</Text>

              {info.stats && info.stats.length > 0 && (
                <View style={s.statsWrap}>
                  {info.stats.map((stat) => (
                    <View key={stat.label} style={s.statRow}>
                      {stat.color && <View style={[s.statDot, { backgroundColor: stat.color }]} />}
                      <Text style={s.statLabel}>{stat.label}</Text>
                      <Text style={s.statValue}>{stat.value}</Text>
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity onPress={openSources} style={s.sourcesLink}>
                <Text style={[s.sourcesLinkText, { color: accentColor }]}>
                  view sources & methodology
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.closeBtn, { backgroundColor: accentColor }]}
                onPress={onClose}
              >
                <Text style={s.closeBtnText}>got it</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const s = StyleSheet.create({
  button: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2,
  },
  buttonLabel: {
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
  },
  sheet: {
    backgroundColor: "rgba(255,255,255,0.98)",
    borderRadius: 28,
    padding: 28,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    color: colours.textPrimary,
    lineHeight: 22,
    opacity: 0.85,
    textAlign: "center",
  },

  statsWrap: { marginTop: 16, gap: 8 },
  statRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statDot: { width: 8, height: 8, borderRadius: 4 },
  statLabel: { flex: 1, fontSize: 13, color: colours.textSecondary },
  statValue: { fontSize: 13, fontWeight: "700", color: colours.textPrimary },

  sourcesLink: { alignSelf: "center", marginTop: 18 },
  sourcesLinkText: { fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },

  closeBtn: {
    marginTop: 14,
    alignSelf: "center",
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 20,
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "white",
  },
});
