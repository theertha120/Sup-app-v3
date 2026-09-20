/**
 * CitationLinks — compact, tappable "sources" list for pop-ups that give a
 * health/posture recommendation (intervention + "time to move" modals).
 * Each row opens the source in an in-app browser; the footer link goes to the
 * full Sources & Methodology page. Apple guideline 1.4.1.
 */

import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Citation, openCitation } from "../../lib/citations";
import { colours } from "../../../theme/colours";

export default function CitationLinks({
  citations,
  onOpenMethodology,
}: {
  citations: Citation[];
  /** Optional footer link to the full sources page. Called before navigating (e.g. to close a parent modal). Omit inside pop-ups whose dismissal has side effects. */
  onOpenMethodology?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={s.wrap}>
      <Pressable onPress={() => setOpen((v) => !v)} hitSlop={8}>
        <Text style={s.toggle}>{open ? "hide sources" : "sources"}</Text>
      </Pressable>

      {open && (
        <View style={s.list}>
          {citations.map((c) => (
            <Pressable key={c.url} onPress={() => openCitation(c.url)} style={s.row}>
              <Text style={s.title}>{c.title}</Text>
              <Text style={s.meta}>{c.authors} — {c.venue}</Text>
            </Pressable>
          ))}
          {onOpenMethodology && (
            <Pressable
              onPress={() => {
                onOpenMethodology();
                router.push("/sources-methodology" as any);
              }}
              hitSlop={8}
            >
              <Text style={s.toggle}>view all sources & methodology</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap:   { alignSelf: "stretch", alignItems: "center", marginBottom: 12 },
  toggle: { fontSize: 12, color: colours.primary, textDecorationLine: "underline", fontFamily: "Agrandir-Regular" },
  list:   { alignSelf: "stretch", marginTop: 8, gap: 8 },
  row:    { backgroundColor: "#F5F3FF", borderRadius: 10, padding: 10 },
  title:  { fontSize: 12, color: colours.textPrimary, fontFamily: "Agrandir-Regular" },
  meta:   { fontSize: 11, color: colours.textSecondary, marginTop: 2, fontFamily: "Agrandir-Regular" },
});
