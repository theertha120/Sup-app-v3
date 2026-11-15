import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addDaysToDateKey, fromLocalDateKey, toLocalDateKey } from '@/src/lib/dateKey';
import { purple, s } from './ui';

/** Matches Stats: a left swipe reveals older data, a right swipe returns to newer data. */
export function WeekCalendar({ anchor, selectedDay, marked, onWeekChange, onSelectDay, onOpenCalendar }: {
  anchor: string; selectedDay: string | null; marked: Set<string>;
  onWeekChange: (day: string) => void; onSelectDay: (day: string | null) => void; onOpenCalendar: () => void;
}) {
  const today = toLocalDateKey();
  const monday = addDaysToDateKey(anchor, -((fromLocalDateKey(anchor).getDay() + 6) % 7));
  const [width, setWidth] = useState(0);
  const offset = useRef(new Animated.Value(0)).current;
  const animating = useRef(false);
  const latest = useRef({ monday, today, width, onWeekChange });
  latest.current = { monday, today, width, onWeekChange };

  const pager = useMemo(() => {
    const allowed = (direction: number) => {
      const next = addDaysToDateKey(latest.current.monday, direction * -7);
      return next >= '1900-01-01' && next <= latest.current.today;
    };
    const settle = (direction: number) => {
      if (animating.current || !latest.current.width) return;
      const step = allowed(direction) ? direction : 0;
      animating.current = true;
      Animated.timing(offset, {
        toValue: -step * latest.current.width, duration: 240,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && step) latest.current.onWeekChange(addDaysToDateKey(latest.current.monday, step * -7));
        animating.current = false;
      });
    };
    return { settle, responder: PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => !animating.current &&
        Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => offset.stopAnimation(),
      onPanResponderMove: (_, gesture) => {
        const direction = gesture.dx < 0 ? 1 : -1;
        const drag = Math.max(-latest.current.width, Math.min(latest.current.width, gesture.dx));
        offset.setValue(allowed(direction) ? drag : drag * 0.25);
      },
      onPanResponderRelease: (_, gesture) => settle(
        gesture.dx < -40 || gesture.vx < -0.3 ? 1 : gesture.dx > 40 || gesture.vx > 0.3 ? -1 : 0,
      ),
      onPanResponderTerminate: () => settle(0),
    }) };
  }, [offset]);

  // Reset before paint when a swipe completes or the calendar jumps to another week.
  useLayoutEffect(() => {
    offset.stopAnimation(); offset.setValue(0); animating.current = false;
    return () => offset.stopAnimation();
  }, [monday, width, offset]);

  return <View style={s.card}>
    <View style={{ overflow: 'hidden' }} onLayout={event => setWidth(event.nativeEvent.layout.width)} {...pager.responder.panHandlers}>
      <Animated.View style={{ flexDirection: 'row', width: width * 3, marginLeft: -width, transform: [{ translateX: offset }] }}>
        {[-1, 0, 1].map(position => {
          const start = addDaysToDateKey(monday, position * -7);
          const days = Array.from({ length: 7 }, (_, index) => addDaysToDateKey(start, index));
          const active = position === 0;
          const count = days.filter(day => marked.has(day)).length;
          const title = days.includes(today) ? 'This week' : `${fromLocalDateKey(start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${fromLocalDateKey(days[6]).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
          return <View key={position} style={{ width, gap: 14 }} pointerEvents={active ? 'auto' : 'none'}
            accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}>
            <View style={s.between}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.heading} accessibilityRole="header" accessibilityHint="Swipe left for older weeks, right for newer weeks."
                  accessibilityActions={[{ name: 'olderWeek', label: 'Older week' }, ...(addDaysToDateKey(monday, 7) <= today ? [{ name: 'newerWeek', label: 'Newer week' }] : [])]}
                  onAccessibilityAction={event => pager.settle(event.nativeEvent.actionName === 'olderWeek' ? 1 : -1)}>{title}</Text>
                <Text style={s.muted}>{count} {count === 1 ? 'day' : 'days'} with logged exercise</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Open exercise calendar" onPress={onOpenCalendar}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="calendar-outline" size={22} color={purple} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row' }}>{days.map((day, index) => {
              const selected = selectedDay === day;
              return <Pressable key={day} accessibilityRole="button"
                accessibilityLabel={`${fromLocalDateKey(day).toDateString()}${marked.has(day) ? ', exercise logged' : ''}`}
                accessibilityState={{ selected, disabled: day > today }} disabled={day > today}
                onPress={() => onSelectDay(selected ? null : day)}
                style={{ flex: 1, minHeight: 74, alignItems: 'center', justifyContent: 'center', gap: 7,
                  borderRadius: 16, backgroundColor: selected ? purple : 'transparent', opacity: day > today ? 0.35 : 1 }}>
                <Text style={[s.muted, selected && { color: '#fff' }]}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</Text>
                <Text style={[s.label, day === today && { color: purple }, selected && { color: '#fff' }]}>{fromLocalDateKey(day).getDate()}</Text>
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: marked.has(day) ? selected ? '#fff' : purple : 'transparent' }} />
              </Pressable>;
            })}</View>
          </View>;
        })}
      </Animated.View>
    </View>
    <Text style={[s.muted, { textAlign: 'center', fontSize: 11 }]}>swipe left for older data</Text>
  </View>;
}
