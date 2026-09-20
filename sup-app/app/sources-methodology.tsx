/**
 * sources-methodology.tsx
 *
 * "Settings → Sources & Methodology" — the single, permanent, always-reachable
 * page every in-app metric explanation (s'napshot, s'core, s'train, ...) links
 * back to. Reachable directly from Settings too, with no active s'pot session
 * required. See src/components/ui/InfoModal.tsx for the "view sources &
 * methodology" link every info popup includes.
 */

import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { colours } from "../theme/colours";

// ── Citations ─────────────────────────────────────────────────────────────────
// All HTTPS, all verified working links. Grouped the way they're actually used
// below: general evidence for wearable/IMU-based posture monitoring, and the
// specific creep/recovery literature s'train's accumulate-fast/recover-slow
// design is based on.

interface Citation {
  authors: string;
  title: string;
  venue: string;
  url: string;
}

const WEARABLE_MONITORING_CITATIONS: Citation[] = [
  {
    authors: "Simpson L, Maharaj MM, Mobbs RJ",
    title: "The Role of Wearables in Spinal Posture Analysis: A Systematic Review",
    venue: "2019",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6368717/",
  },
  {
    authors: "Lee R, James C, Edwards S, et al.",
    title: "Evidence for the Effectiveness of Feedback from Wearable Inertial Sensors during Work-Related Activities: A Scoping Review",
    venue: "Sensors, 2021;21(19):6377",
    url: "https://doi.org/10.3390/s21196377",
  },
  {
    authors: "Figueira V, et al.",
    title: "Wearables for Monitoring and Postural Feedback in the Work Environment: A Scoping Review",
    venue: "Sensors, 2024;24(4):1341",
    url: "https://pubmed.ncbi.nlm.nih.gov/38400498/",
  },
];

const STRAIN_CITATIONS: Citation[] = [
  {
    authors: "Kang SH, Mirka GA",
    title: "Creep Deformation of Viscoelastic Lumbar Tissue During Sustained Submaximal Trunk Flexion Postures",
    venue: "Journal of Biomechanics, 2023;155:111647",
    url: "https://pubmed.ncbi.nlm.nih.gov/37245386/",
  },
  {
    authors: "Kang SH, Mirka GA",
    title: "Cumulative Creep Response of Viscoelastic Lumbar Tissue as a Function of Work-Rest Schedule",
    venue: "Journal of Electromyography and Kinesiology, 2024;78:102916",
    url: "https://pubmed.ncbi.nlm.nih.gov/38909410/",
  },
];

// Opens in an in-app browser (SFSafariViewController on iOS, Custom Tabs on
// Android) rather than backgrounding the app into external Safari/Chrome.
async function openCitation(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    // Fallback if the in-app browser fails to open for any reason.
    Linking.openURL(url).catch(() => {});
  }
}

function CitationRow({ citation }: { citation: Citation }) {
  return (
    <Pressable style={styles.citationRow} onPress={() => openCitation(citation.url)}>
      <Text style={styles.citationTitle}>{citation.title}</Text>
      <Text style={styles.citationMeta}>{citation.authors} — {citation.venue}</Text>
      <Text style={styles.citationLink} numberOfLines={1}>{citation.url}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function SourcesMethodologyScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>sources & methodology</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          this page explains exactly what your s'pots record, how every number in the app is
          calculated, and which parts are s'up's own design versus findings from published
          research. it's always available here — you don't need an active session to read it.
        </Text>

        <Section title="what the two s'pots record">
          <Text style={styles.body}>
            each s'pot contains a motion sensor (accelerometer + gyroscope) worn on your back —
            one at your upper back (roughly between the shoulder blades) and one at your lower
            back (roughly waistband height). each sensor reports its orientation about ten times
            per second. the app compares the angle of the upper sensor to the angle of the lower
            sensor to estimate how far you're leaning forward, backward, or sideways relative to
            your own calibrated neutral position — not an absolute or universal "correct" posture.
          </Text>
        </Section>

        <Section title="calibration">
          <Text style={styles.body}>
            before tracking begins, you complete a short 5-step calibration: sit in your own
            natural upright position (this becomes your personal zero-reference, since posture
            and sensor mounting both vary person to person), then lean forward, backward, right,
            and left to your comfortable limit. calibration's job is orientation, not thresholds:
            the forward and right lean steps tell the app which way your s'pots are physically
            worn, so "forward" and "right" are always interpreted correctly no matter which of the
            two possible mounting rotations your kit is in. the classification bands below are the
            same fixed values for every user once orientation is correctly resolved — calibration
            doesn't rescale them.
          </Text>
        </Section>

        <Section title="posture classifications">
          <Text style={styles.body}>
            every reading is classified into one of these states, based on the angle between your
            two s'pots relative to your calibrated neutral position:
          </Text>
          <View style={styles.table}>
            {[
              ["upright", "0°–12° forward (or leaning back)"],
              ["transition", "12°–18° forward"],
              ["forward lean", "18°–28° forward"],
              ["slouched", "28°–42° forward"],
              ["severe", "more than 42° forward"],
              ["tilted left / right", "more than 8° sideways, when sideways lean dominates"],
            ].map(([label, range]) => (
              <View key={label} style={styles.tableRow}>
                <Text style={styles.tableLabel}>{label}</Text>
                <Text style={styles.tableValue}>{range}</Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="s'napshot percentages">
          <Text style={styles.body}>
            the percentages shown in your daily s'napshot are simply the share of your tracked
            time today spent in each posture classification above — e.g. if you were upright for
            24 of 40 tracked minutes, that's 60% upright. it's a plain time breakdown, not a
            separate calculation.
          </Text>
        </Section>

        <Section title="what is s'train?">
          <Text style={styles.body}>
            s'train is s'up's proprietary posture-awareness indicator. it reflects the duration
            and degree of posture deviation detected relative to your personal calibrated range.
            it does not measure physical force, tissue strain, injury, pain, or a medical
            condition.
          </Text>
          <Text style={styles.body}>
            s'train rises while you're in a non-upright posture state — faster for more severe
            states — and falls slowly while you're upright. that recovery is intentionally much
            slower than the build-up, so a brief correction doesn't fully "reset" it. this
            accumulate-fast/recover-slow design is modelled on published research into how
            sustained postures affect the body over time (see citations below) — s'train itself
            is not a clinical or diagnostic measurement.
          </Text>
        </Section>

        <Section title="the complete s'up s'core formula">
          <Text style={styles.body}>
            your daily s'up s'core is out of 100 points, made up of three parts:
          </Text>
          <View style={styles.table}>
            <View style={styles.tableRow}>
              <Text style={styles.tableLabel}>quality — up to 50 pts</Text>
              <Text style={styles.tableValue}>
                (your average posture quality score for the day ÷ 100) × 50
              </Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={styles.tableLabel}>showing up — up to 30 pts</Text>
              <Text style={styles.tableValue}>
                15 pts base for any tracked time, +5/+10/+15 more at 30/60/120 tracked minutes
              </Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={styles.tableLabel}>streak — up to 20 pts</Text>
              <Text style={styles.tableValue}>3 pts per consecutive day tracked, capped at 20</Text>
            </View>
          </View>
          <Text style={styles.body}>
            the "average posture quality" behind the quality component is a real-time score that
            starts at 100 each session and moves based on the posture classifications above —
            rising slowly while upright, falling (faster for more severe states) while not — using
            the same accumulate-fast/recover-slow design as s'train.
          </Text>
        </Section>

        <Section title="s'up's calculations vs. external research">
          <Text style={styles.body}>
            to be clear about what's ours and what's cited evidence: the specific angle
            thresholds, point values, and formulas above (posture classification bands, the
            s'core formula, streak/showing-up scoring) are s'up's own product design choices,
            tuned by reasoning rather than a clinical study of this exact app. the underlying
            <Text style={{ fontWeight: "700" }}> design principle </Text>
            — that sustained poor posture accumulates strain that recovers more slowly than it
            built up — is grounded in the published research listed below. none of the numbers in
            this app are a medical measurement, diagnosis, or clinical score.
          </Text>
        </Section>

        <Section title="general wellness disclaimer">
          <Text style={styles.body}>
            s'up is a general wellness and posture-awareness tool. it is not a medical device and
            is not intended to diagnose, treat, cure, or prevent any disease or medical condition.
            the information in this app, including s'train and your s'up s'core, does not
            constitute medical advice. if you have pain, an existing back or posture-related
            condition, or any health concern, please consult a qualified healthcare professional.
          </Text>
        </Section>

        <Section title="wearable posture feedback — cited evidence">
          {WEARABLE_MONITORING_CITATIONS.map((c) => (
            <CitationRow key={c.url} citation={c} />
          ))}
        </Section>

        <Section title="sustained posture & s'train — cited evidence">
          {STRAIN_CITATIONS.map((c) => (
            <CitationRow key={c.url} citation={c} />
          ))}
        </Section>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colours.background },
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
  backIcon: { fontSize: 24, color: "#222" },
  headerTitle: { fontSize: 18, fontWeight: "600", color: "#222" },
  placeholder: { width: 40 },

  scroll: { flex: 1, paddingHorizontal: 20 },
  intro: {
    fontSize: 13,
    color: colours.textSecondary,
    lineHeight: 20,
    marginTop: 20,
    marginBottom: 8,
  },

  section: { marginTop: 24 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colours.textPrimary,
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: colours.textPrimary,
    lineHeight: 21,
    marginBottom: 10,
  },

  table: {
    backgroundColor: colours.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colours.border,
    marginBottom: 10,
    overflow: "hidden",
  },
  tableRow: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colours.border,
    gap: 2,
  },
  tableLabel: { fontSize: 13, fontWeight: "700", color: colours.textPrimary },
  tableValue: { fontSize: 12, color: colours.textSecondary },

  citationRow: {
    backgroundColor: colours.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colours.border,
    padding: 14,
    marginBottom: 10,
  },
  citationTitle: { fontSize: 13, fontWeight: "700", color: colours.textPrimary, marginBottom: 4 },
  citationMeta: { fontSize: 12, color: colours.textSecondary, marginBottom: 4 },
  citationLink: { fontSize: 12, color: colours.primary, textDecorationLine: "underline" },
});
