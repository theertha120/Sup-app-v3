import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { fromLocalDateKey, toLocalDateKey } from '@/src/lib/dateKey';
import { Button, s, purple, soft } from './ui';

export function DateCalendar({ value, onChange, marked = [] }: {
  value: string; onChange: (date: string) => void; marked?: string[];
}) {
  const [month, setMonth] = useState(() => {
    const date = fromLocalDateKey(value); date.setDate(1); return date;
  });
  const today = toLocalDateKey();
  const offset = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const move = (amount: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1));
  return <View style={{ gap: 12 }}>
    <View style={s.between}>
      <Button label="‹" secondary onPress={() => move(-1)} disabled={month.getFullYear() <= 1900 && month.getMonth() === 0} />
      <Text accessibilityRole="header" style={s.label}>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
      <Button label="›" secondary onPress={() => move(1)} disabled={toLocalDateKey(month).slice(0, 7) >= today.slice(0, 7)} />
    </View>
    <View style={{ flexDirection: 'row' }}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) =>
      <Text key={index} style={[s.muted, { width: '14.2857%', textAlign: 'center' }]}>{day}</Text>)}</View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {Array.from({ length: offset + days }, (_, index) => {
        const day = index - offset + 1;
        if (day < 1) return <View key={index} style={{ width: '14.2857%', height: 48 }} />;
        const key = toLocalDateKey(new Date(month.getFullYear(), month.getMonth(), day));
        const selected = key === value;
        return <Pressable key={index} accessibilityRole="button" accessibilityLabel={fromLocalDateKey(key).toDateString()}
          accessibilityState={{ selected, disabled: key > today }} disabled={key > today} onPress={() => onChange(key)}
          style={{ width: '14.2857%', minHeight: 48, justifyContent: 'center', alignItems: 'center',
            borderRadius: 14, backgroundColor: selected ? purple : 'transparent', opacity: key > today ? 0.3 : 1 }}>
          <Text style={[s.text, selected && { color: '#fff' }]}>{day}</Text>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: marked.includes(key) ? selected ? '#fff' : purple : 'transparent' }} />
        </Pressable>;
      })}
    </View>
    <Pressable accessibilityRole="button" onPress={() => { setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); onChange(today); }}
      style={{ padding: 14, backgroundColor: soft, borderRadius: 14 }}><Text style={[s.label, { textAlign: 'center' }]}>Today</Text></Pressable>
  </View>;
}
