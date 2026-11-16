import React from 'react';
import { Pressable, Text, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';

export const ink = '#1D014A';
export const purple = '#5222AE';
export const soft = '#EDE8FF';
export function Button({ label, onPress, secondary = false, disabled = false, style, selected }: {
  label: string; onPress: () => void; secondary?: boolean; disabled?: boolean;
  style?: StyleProp<ViewStyle>; selected?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }}
    disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, secondary && s.secondary, selected && s.selected, style,
      { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
    <Text style={[s.buttonText, secondary && { color: purple }]}>{label}</Text>
  </Pressable>;
}
export const s = StyleSheet.create({
  title: { fontFamily: 'Agrandir-GrandHeavy', fontSize: 30, color: ink },
  heading: { fontFamily: 'Agrandir-GrandHeavy', fontSize: 19, color: ink },
  label: { fontFamily: 'Agrandir-TextBold', fontSize: 14, color: ink },
  text: { fontFamily: 'Agrandir-Regular', fontSize: 14, lineHeight: 21, color: ink },
  muted: { fontFamily: 'Agrandir-Regular', fontSize: 13, lineHeight: 19, color: '#716480' },
  card: { backgroundColor: '#fff', borderRadius: 24, padding: 20, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  button: { minHeight: 48, paddingHorizontal: 18, paddingVertical: 13, backgroundColor: purple,
    borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  secondary: { backgroundColor: soft },
  selected: { borderWidth: 1.5, borderColor: purple },
  buttonText: { fontFamily: 'Agrandir-TextBold', color: '#fff', fontSize: 14, textAlign: 'center' },
  input: { minHeight: 48, backgroundColor: '#F6F3FA', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 10, fontFamily: 'Agrandir-Regular', fontSize: 16, color: ink,
    borderWidth: 1, borderColor: '#E6DEEF' },
  error: { fontFamily: 'Agrandir-Regular', fontSize: 14, color: '#A32949', lineHeight: 21 },
});
