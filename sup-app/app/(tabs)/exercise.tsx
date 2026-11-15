import React, { useCallback, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HeaderBar from '@/src/components/ui/HeaderBar';
import BackgroundBlobs from '@/src/components/ui/BackgroundBlobs';
import { BrandAlert } from '@/src/components/ui/BrandAlert';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import { toLocalDateKey, fromLocalDateKey, addDaysToDateKey } from '@/src/lib/dateKey';
import { fetchWorkouts, saveWorkout, deleteWorkout } from '@/src/services/exercise/exerciseLogService';
import { formatAmount, repeatWorkout, FEELINGS, type Workout, type WorkoutInput } from '@/src/features/exercise/model';
import { Button, s, purple, soft } from '@/src/features/exercise/ui';
import { WeekCalendar } from '@/src/features/exercise/WeekCalendar';
import { DateCalendar } from '@/src/features/exercise/DateCalendar';
import { WorkoutForm } from '@/src/features/exercise/WorkoutForm';
export { default as ErrorBoundary } from '@/src/components/ui/ScreenErrorBoundary';

type Editor = { id?: string; initial?: WorkoutInput };
export default function ExerciseLogScreen() {
  const { userId } = useAuth();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const owner = useRef(userId); owner.current = userId;
  const request = useRef(0);
  const [data, setData] = useState<{ owner: string; rows: Workout[] } | null>(null);
  const workouts = data?.owner === userId ? data.rows : [];
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [weekAnchor, setWeekAnchor] = useState(toLocalDateKey());
  const [calendar, setCalendar] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [actions, setActions] = useState<Workout | null>(null);
  const [deleting, setDeleting] = useState<Workout | null>(null);
  const [fontsLoaded, fontError] = useFonts({
    'Agrandir-Regular': require('../../assets/fonts/Agrandir-Regular.otf'),
    'Agrandir-TextBold': require('../../assets/fonts/Agrandir-TextBold.otf'),
    'Agrandir-GrandHeavy': require('../../assets/fonts/Agrandir-GrandHeavy.otf'),
  });
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setLoadError(false);
    if (!userId) { setData(null); setLoading(false); return; }
    try {
      const rows = await fetchWorkouts(userId);
      if (current === request.current && owner.current === userId) setData({ owner: userId, rows });
    } catch { if (current === request.current && owner.current === userId) setLoadError(true); }
    finally { if (current === request.current && owner.current === userId) setLoading(false); }
  }, [userId]);
  useFocusEffect(useCallback(() => {
    setEditor(null); setActions(null); setDeleting(null);
    void load();
    return () => { request.current++; };
  }, [load]));
  const save = async (input: WorkoutInput) => {
    if (!userId) throw new Error('Sign in to save workouts.');
    const saved = await saveWorkout(userId, input, editor?.id);
    if (owner.current !== userId) return;
    request.current++; setLoading(false);
    setData(current => ({ owner: userId, rows: [saved, ...(current?.owner === userId ? current.rows : []).filter(row => row.id !== saved.id)]
      .sort((a, b) => b.performed_on.localeCompare(a.performed_on) || b.created_at.localeCompare(a.created_at)) }));
    setSelectedDay(null); setWeekAnchor(saved.performed_on); setEditor(null);
    showToast(editor?.id ? 'Workout updated' : 'Workout saved', 'success');
  };
  const remove = async (workout: Workout) => {
    if (!userId || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      await deleteWorkout(userId, workout.id);
      if (owner.current !== userId) return;
      request.current++; setLoading(false);
      setData(current => current?.owner === userId ? { ...current, rows: current.rows.filter(row => row.id !== workout.id) } : current);
      showToast('Workout deleted', 'success');
    } catch { if (owner.current === userId) showToast('Could not delete this workout. Please try again.', 'error'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const today = toLocalDateKey();
  const activeDays = new Set(workouts.map(workout => workout.performed_on));
  const visible = workouts.filter(workout => !selectedDay || workout.performed_on === selectedDay);
  const groups = [...new Set(visible.map(workout => workout.performed_on))];
  const dateLabel = (date: string) => date === today ? 'Today' : date === addDaysToDateKey(today, -1) ? 'Yesterday' :
    fromLocalDateKey(date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  if (!fontsLoaded && !fontError) return <View style={styles.center}><ActivityIndicator color={purple} /></View>;
  return <View style={styles.page}>
    <BackgroundBlobs />
    <ScrollView showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={() => void load()} tintColor={purple} />}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 125 + insets.bottom }}>
      <HeaderBar />
      <View style={{ paddingHorizontal: 20, paddingTop: 24, gap: 20 }}>
        <WeekCalendar anchor={weekAnchor} selectedDay={selectedDay} marked={activeDays}
          onWeekChange={day => { setWeekAnchor(day); setSelectedDay(null); }}
          onSelectDay={setSelectedDay} onOpenCalendar={() => setCalendar(true)} />
        <Button label="+ Log exercise" onPress={() => setEditor({})} disabled={!userId || busy} />
        {selectedDay && <View style={s.between}><Text style={s.label}>{dateLabel(selectedDay)}</Text><Button label="Show all dates" secondary onPress={() => setSelectedDay(null)} /></View>}
        {loadError ? <View style={s.card}><Text style={s.error}>We couldn’t load your exercise history. Please try again.</Text><Button label="Retry" secondary onPress={() => void load()} /></View> : null}
        {loading && !data ? <ActivityIndicator color={purple} accessibilityLabel="Loading workouts" /> : null}
        {!loading && !loadError && visible.length === 0 && <View style={[s.card, { alignItems: 'center', paddingVertical: 30 }]}>
          <View style={styles.emptyIcon}><Ionicons name="barbell" size={30} color={purple} /></View>
          <Text style={[s.heading, { textAlign: 'center' }]}>{!userId ? 'Sign in to keep your exercise log' : workouts.length ? 'No workouts here yet' : 'Your exercise history starts here'}</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>{workouts.length ? 'Try another day or log an exercise.' : 'Record what you trained and how your back felt, one workout at a time.'}</Text>
          {!workouts.length && <Text style={[s.muted, { textAlign: 'center' }]}>A stronger core and upper back make sitting upright easier.</Text>}
        </View>}
        {groups.map(day => <View key={day} style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={s.heading}>{dateLabel(day)}</Text>
          {visible.filter(workout => workout.performed_on === day).map(workout => {
            const strength = workout.exercises.some(exercise => exercise.category === 'strength');
            const other = workout.exercises.some(exercise => exercise.category === 'other');
            return <View key={workout.id} style={s.card}>
              <View style={s.between}><View style={[s.row, { flex: 1 }]}><View style={styles.workoutIcon}><Ionicons name={strength ? 'barbell' : 'fitness-outline'} size={21} color={purple} /></View>
                <Text style={[s.label, { flexShrink: 1 }]}>{strength && other ? 'Mixed workout' : strength ? 'Strength' : workout.exercises.length === 1 ? workout.exercises[0].name : 'Activity'}</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Options for ${workout.exercises.map(exercise => exercise.name).join(', ')} on ${dateLabel(day)}`} disabled={busy} onPress={() => setActions(actions?.id === workout.id ? null : workout)} style={styles.iconButton}><Ionicons name="ellipsis-horizontal" size={22} color={purple} /></Pressable>
              </View>
              {workout.exercises.map((exercise, index) => <View key={index} style={[s.between, { alignItems: 'flex-start' }]}><Text style={[s.text, { flex: 1 }]}>{exercise.name}</Text><Text style={[s.label, { flex: 1, textAlign: 'right', lineHeight: 21 }]}>{formatAmount(exercise)}</Text></View>)}
              <View style={styles.feeling}><Text style={s.muted}>Back felt</Text><Text style={[s.label, { color: purple }]}>{workout.back_feeling}/5 · {FEELINGS[workout.back_feeling - 1]}</Text></View>
              {actions?.id === workout.id && <View style={[s.row, { flexWrap: 'wrap' }]}>
                <Button label="Edit" secondary onPress={() => { setActions(null); setEditor({ id: workout.id, initial: workout }); }} />
                <Button label="Log again" secondary onPress={() => { setActions(null); setEditor({ initial: repeatWorkout(workout) }); }} />
                <Button label="Delete" secondary onPress={() => { setActions(null); setDeleting(workout); }} />
              </View>}
            </View>;
          })}
        </View>)}
      </View>
    </ScrollView>
    {editor && userId && <WorkoutForm key={userId} initial={editor.initial} editing={!!editor.id} history={workouts} onClose={() => setEditor(null)} onSave={save} />}
    <BrandAlert visible={!!deleting} title="Delete this workout?" message="This removes all exercises and the back-feeling rating in this workout." onRequestClose={() => setDeleting(null)} buttons={[
      { text: 'Keep workout', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { if (deleting) void remove(deleting); } },
    ]} />
    <Modal visible={calendar} transparent animationType="fade" onRequestClose={() => setCalendar(false)}>
      <View style={styles.calendarOverlay}><View style={[s.card, { width: '100%', maxWidth: 420 }]}>
        <View style={s.between}><Text style={s.heading}>Exercise calendar</Text><Button label="Close" secondary onPress={() => setCalendar(false)} /></View>
        <DateCalendar key={calendar ? 'open' : 'closed'} value={selectedDay ?? weekAnchor} marked={[...activeDays]} onChange={day => { setSelectedDay(day); setWeekAnchor(day); setCalendar(false); }} />
      </View></View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: 'rgba(211,193,231,0.64)' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { backgroundColor: soft, borderRadius: 24, padding: 18 },
  workoutIcon: { backgroundColor: soft, borderRadius: 12, padding: 9 },
  feeling: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', paddingTop: 14, borderTopWidth: 1, borderTopColor: '#F0EBF6' },
  calendarOverlay: { flex: 1, backgroundColor: 'rgba(29,1,74,0.35)', justifyContent: 'center', alignItems: 'center', padding: 20 },
});
