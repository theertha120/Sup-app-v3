import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FEELINGS } from './model';
import { s, purple, soft } from './ui';
import { POSTURE_LABELS, type PostureCheckin, type PostureCheckinPosture } from '@/src/services/posture/postureCheckinService';

const PREVIEW = 5;

/** Phone-local calendar day a check-in belongs to (same YYYY-MM-DD keys as workouts). */
export function checkinDay(checkin: Pick<PostureCheckin, 'logged_at'>, toDateKey: (date: Date) => string): string {
  return toDateKey(new Date(checkin.logged_at));
}

/** Count, most frequent posture (ties → most recent), and average back rating for a day. */
export function summarizeCheckins(checkins: PostureCheckin[]) {
  const counts = new Map<PostureCheckinPosture, number>();
  for (const c of checkins) counts.set(c.posture, (counts.get(c.posture) ?? 0) + 1);
  let top: PostureCheckinPosture | null = null;
  for (const c of checkins) if (!top || (counts.get(c.posture) ?? 0) > (counts.get(top) ?? 0)) top = c.posture;
  const avgBack = checkins.length ? checkins.reduce((sum, c) => sum + c.back_feel, 0) / checkins.length : null;
  return { count: checkins.length, top, avgBack };
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** One day's posture check-ins on the exercise log page, newest first. */
export function PostureCheckinsCard({ checkins, dayLabel }: { checkins: PostureCheckin[]; dayLabel: string }) {
  const [expanded, setExpanded] = useState(false);
  const { count, top, avgBack } = summarizeCheckins(checkins);
  const shown = expanded ? checkins : checkins.slice(0, PREVIEW);
  return <View style={s.card} accessibilityLabel={`Posture check-ins on ${dayLabel}`}>
    <View style={s.row}>
      <View style={styles.icon}><Ionicons name="body-outline" size={21} color={purple} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.label}>Posture check-ins</Text>
        <Text style={s.muted}>
          {count} {count === 1 ? 'check-in' : 'check-ins'}
          {top ? ` · mostly ${POSTURE_LABELS[top]}` : ''}
          {avgBack !== null ? ` · back ${avgBack.toFixed(1)}/5` : ''}
        </Text>
      </View>
    </View>
    {shown.map(c => <View key={c.id} style={[s.between, styles.entry]}>
      <Text style={[s.muted, styles.time]}>{time(c.logged_at)}</Text>
      <Text style={[s.text, { flex: 1 }]}>{POSTURE_LABELS[c.posture] ?? c.posture}</Text>
      <Text style={[s.label, { color: purple }]}>{c.back_feel}/5 · {FEELINGS[c.back_feel - 1]}</Text>
    </View>)}
    {count > PREVIEW && <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)} style={styles.more}>
      <Text style={[s.label, { color: purple }]}>{expanded ? 'Show less' : `Show all ${count}`}</Text>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  icon: { backgroundColor: soft, borderRadius: 12, padding: 9 },
  entry: { paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F0EBF6' },
  time: { width: 72 },
  more: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 },
});
