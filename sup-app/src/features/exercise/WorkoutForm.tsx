import React, { useRef, useState } from 'react';
import { View, Text, Modal, ScrollView, TextInput, KeyboardAvoidingView, Platform, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toLocalDateKey, fromLocalDateKey } from '@/src/lib/dateKey';
import { EXERCISES, FEELINGS, validateWorkout, type WorkoutInput, type ExerciseEntry, type Workout } from './model';
import { Button, s, purple, soft } from './ui';
import { DateCalendar } from './DateCalendar';

type DraftEntry = Omit<ExerciseEntry, 'values'> & { values: string[]; count: string; individual: boolean; custom: boolean };
const draft = (exercise: ExerciseEntry): DraftEntry => ({ ...exercise,
  custom: !EXERCISES.some(known => known.name === exercise.name && known.category === exercise.category),
  values: exercise.values.map(String), count: String(exercise.values.length),
  individual: !exercise.values.every(value => value === exercise.values[0]),
});
export function WorkoutForm({ initial, editing, history, onClose, onSave }: {
  initial?: WorkoutInput; editing: boolean; history: Workout[];
  onClose: () => void; onSave: (input: WorkoutInput) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [date, setDate] = useState(initial?.performed_on ?? toLocalDateKey());
  const [feeling, setFeeling] = useState(initial?.back_feeling ?? 0);
  const [entries, setEntries] = useState<DraftEntry[]>(() => initial?.exercises.map(draft) ?? []);
  const [picker, setPicker] = useState(!initial);
  const [query, setQuery] = useState('');
  const [calendar, setCalendar] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const patch = (index: number, change: Partial<DraftEntry>) => {
    setEntries(current => current.map((entry, i) => i === index ? { ...entry, ...change } : entry)); setDirty(true);
  };
  const add = (exercise: Omit<ExerciseEntry, 'values'>, custom = !EXERCISES.some(known => known.name === exercise.name && known.category === exercise.category)) => {
    if (entries.length >= 30) { setError('A workout can contain up to 30 exercises.'); setPicker(false); return; }
    setEntries(current => [...current, { ...exercise, values: [''], count: '1', individual: false, custom }]);
    setPicker(false); setQuery(''); setDirty(true); scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const recent = history.flatMap(workout => workout.exercises).filter((entry, index, all) =>
    all.findIndex(other => other.name.toLowerCase() === entry.name.toLowerCase() && other.unit === entry.unit) === index);
  const requestClose = () => { if (savingRef.current) return; if (dirty) setConfirmClose(true); else onClose(); };
  const save = async () => {
    if (savingRef.current) return;
    const invalidCount = entries.some(entry => entry.unit !== 'minutes' && !entry.individual &&
      (!/^\d+$/.test(entry.count) || Number(entry.count) < 1 || Number(entry.count) > 50));
    const input: WorkoutInput = { performed_on: date, back_feeling: feeling, exercises: entries.map(entry => ({
      name: entry.name.trim(), category: entry.category, unit: entry.unit,
      values: entry.unit === 'minutes' || entry.individual ? entry.values.map(value => Number(value.replace(',', '.')))
        : Array.from({ length: Math.min(50, Math.max(0, Number(entry.count) || 0)) }, () => Number(entry.values[0])),
    })) };
    const validation = invalidCount ? 'Enter a whole number of sets between 1 and 50.' : validateWorkout(input);
    if (validation) { setError(validation); return; }
    savingRef.current = true; setSaving(true); setConfirmClose(false); setError('');
    try { await onSave(input); } catch { setError('Your workout could not be saved. Your entries are still here; please try again.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <Modal transparent animationType="slide" visible onRequestClose={requestClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16), maxHeight: '94%' }]} accessibilityViewIsModal>
        <View style={styles.handle} />
        <View style={[s.between, { paddingHorizontal: 22, paddingBottom: 14 }]}>
          <Text accessibilityRole="header" style={s.heading}>{picker ? 'Choose an exercise' : editing ? 'Edit workout' : 'Log exercise'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close exercise log" onPress={requestClose} disabled={saving} style={styles.close}>
            <Text style={s.heading}>×</Text>
          </Pressable>
        </View>
        {confirmClose ? <View style={{ paddingHorizontal: 22, gap: 12, paddingBottom: 16 }}>
          <Text style={s.text}>Discard your unsaved changes?</Text>
          <View style={s.row}><Button label="Keep editing" secondary onPress={() => setConfirmClose(false)} style={{ flex: 1 }} />
            <Button label="Discard" onPress={onClose} style={{ flex: 1 }} /></View>
        </View> : null}
        <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 24, gap: 20 }}>
          <View pointerEvents={saving ? 'none' : 'auto'} style={{ gap: 20 }}>
          {picker ? <>
            <TextInput value={query} onChangeText={setQuery} placeholder="Search exercises" placeholderTextColor="#8A7E97" accessibilityLabel="Search exercises" style={s.input} autoCorrect={false} />
            {!query && recent.length > 0 && <View style={{ gap: 10 }}><Text style={s.label}>Recently logged</Text>
              <View style={styles.wrap}>{recent.slice(0, 5).map((exercise, index) => <Button key={index} label={exercise.name} secondary onPress={() => add(exercise)} />)}</View></View>}
            {(['strength', 'other'] as const).map(category => <View key={category} style={{ gap: 8 }}>
              <Text style={s.heading}>{category === 'strength' ? 'Strength' : 'Other activities'}</Text>
              {EXERCISES.filter(exercise => exercise.category === category && exercise.name.toLowerCase().includes(query.trim().toLowerCase())).map(exercise =>
                <Pressable key={exercise.name} accessibilityRole="button" onPress={() => add(exercise)} style={styles.option}>
                  <Text style={s.label}>{exercise.name}</Text><Text style={s.muted}>{exercise.unit === 'minutes' ? 'Minutes' : exercise.unit === 'seconds' ? 'Sets × seconds' : 'Sets × reps'}  +</Text>
                </Pressable>)}
              <Button label={category === 'strength' ? '+ Other strength exercise' : '+ Other activity'} secondary onPress={() => add({ name: query.trim(), category, unit: category === 'strength' ? 'reps' : 'minutes' }, true)} />
            </View>)}
            <Button label="Back to workout" secondary onPress={() => { setPicker(false); setQuery(''); }} />
          </> : <>
            <View style={{ gap: 10 }}><Text style={s.label}>When did you train?</Text>
              <Button label={fromLocalDateKey(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                secondary onPress={() => setCalendar(!calendar)} />
              {calendar && <DateCalendar value={date} onChange={value => { setDate(value); setDirty(true); setCalendar(false); }} />}
            </View>
            {entries.map((entry, index) => {
              const custom = entry.custom;
              const previous = recent.find(exercise => exercise.name.toLowerCase() === entry.name.trim().toLowerCase() && exercise.unit === entry.unit);
              return <View key={index} style={styles.entry}>
                <View style={s.between}><Text style={[s.heading, { flex: 1 }]}>{index + 1}. {entry.name || 'Custom exercise'}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${entry.name || 'exercise'}`} onPress={() => { setEntries(current => current.filter((_, i) => i !== index)); setDirty(true); }} style={styles.close}><Text style={s.muted}>×</Text></Pressable>
                </View>
                {custom && <TextInput accessibilityLabel="Exercise name" placeholder="Exercise name" placeholderTextColor="#8A7E97" value={entry.name} maxLength={80} onChangeText={name => patch(index, { name })} style={s.input} />}
                {custom && entry.category === 'strength' && <View style={s.row}>{(['reps', 'seconds'] as const).map(unit =>
                  <Button key={unit} label={unit === 'reps' ? 'Reps' : 'Seconds'} secondary selected={entry.unit === unit} onPress={() => patch(index, { unit, values: [''], individual: false, count: '1' })} />)}</View>}
                {previous && <Pressable accessibilityRole="button" onPress={() => patch(index, { ...draft(previous), custom: entry.custom })} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={[s.label, { color: purple }]}>↺ Use last values</Text></Pressable>}
                {entry.individual ? <>
                  {entry.values.map((value, setIndex) => <View key={setIndex} style={s.row}>
                    <Text style={[s.muted, { width: 48 }]}>Set {setIndex + 1}</Text>
                    <TextInput accessibilityLabel={`Set ${setIndex + 1} ${entry.unit}`} value={value} keyboardType="number-pad" maxLength={5} style={[s.input, { flex: 1 }]} placeholder={entry.unit} placeholderTextColor="#8A7E97"
                      onChangeText={text => patch(index, { values: entry.values.map((old, i) => i === setIndex ? text : old) })} />
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remove set ${setIndex + 1}`} disabled={entry.values.length === 1} style={styles.close}
                      onPress={() => patch(index, { values: entry.values.filter((_, i) => i !== setIndex) })}><Text style={s.muted}>−</Text></Pressable>
                  </View>)}
                  <Button label="+ Add set" secondary disabled={entry.values.length >= 50} onPress={() => patch(index, { values: [...entry.values, entry.values[entry.values.length - 1]] })} />
                </> : <View style={s.row}>
                  {entry.unit !== 'minutes' && <View style={{ flex: 1, gap: 6 }}><Text style={s.muted}>Sets</Text>
                    <TextInput accessibilityLabel={`${entry.name} sets`} value={entry.count} onChangeText={count => patch(index, { count })} keyboardType="number-pad" maxLength={2} style={s.input} /></View>}
                  <View style={{ flex: 2, gap: 6 }}><Text style={s.muted}>{entry.unit === 'minutes' ? 'Duration (minutes)' : entry.unit === 'seconds' ? 'Seconds per hold' : 'Reps per set'}</Text>
                    <TextInput accessibilityLabel={`${entry.name} ${entry.unit}`} value={entry.values[0]} onChangeText={value => patch(index, { values: [value] })}
                      keyboardType={entry.unit === 'minutes' ? 'decimal-pad' : 'number-pad'} placeholder="0" placeholderTextColor="#8A7E97" maxLength={8} style={s.input} /></View>
                </View>}
                {entry.unit !== 'minutes' && !entry.individual && <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => patch(index, {
                  individual: true, values: Array.from({ length: Math.min(50, Math.max(1, Number(entry.count) || 1)) }, () => entry.values[0]),
                })}><Text style={[s.muted, { color: purple }]}>Different values per set</Text></Pressable>}
              </View>;
            })}
            <Button label="+ Add another exercise" secondary disabled={entries.length >= 30} onPress={() => { setPicker(true); scroll.current?.scrollTo({ y: 0 }); }} />
            <View style={{ gap: 12 }}>
              <Text style={s.heading}>How did your back feel?</Text><Text style={s.muted}>After this workout</Text>
              <View style={s.row}>{FEELINGS.map((label, index) => <Pressable key={label} accessibilityRole="radio" accessibilityLabel={`${index + 1}, ${label}`} accessibilityState={{ checked: feeling === index + 1 }}
                onPress={() => { setFeeling(index + 1); setDirty(true); }} style={[styles.rating, feeling === index + 1 && { backgroundColor: purple }]}>
                <Text style={[s.heading, feeling === index + 1 && { color: '#fff' }]}>{index + 1}</Text>
              </Pressable>)}</View>
              <View style={s.between}><Text style={s.muted}>1 · Stiff</Text><Text style={[s.label, { color: purple }]}>{feeling ? FEELINGS[feeling - 1] : ''}</Text><Text style={s.muted}>5 · Great</Text></View>
            </View>
          </>}
          </View>
        </ScrollView>
        <View style={{ paddingHorizontal: 22, gap: 10 }}>
          {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
          {!picker && <Button label={saving ? 'Saving…' : editing ? 'Save changes' : 'Save workout'} onPress={save} disabled={saving} />}
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(29,1,74,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 30, borderTopRightRadius: 30, flexShrink: 1 },
  handle: { width: 36, height: 4, backgroundColor: '#DED5E9', borderRadius: 2, alignSelf: 'center', marginVertical: 12 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, backgroundColor: '#F8F6FB', borderRadius: 14 },
  entry: { backgroundColor: '#FBFAFD', padding: 16, borderRadius: 20, borderWidth: 1, borderColor: '#EEE8F4', gap: 12 },
  rating: { flex: 1, minHeight: 48, borderRadius: 15, backgroundColor: soft, alignItems: 'center', justifyContent: 'center' },
});
