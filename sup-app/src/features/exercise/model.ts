import { toLocalDateKey, fromLocalDateKey } from '../../lib/dateKey';

export type ExerciseCategory = 'strength' | 'other';
export type ExerciseUnit = 'reps' | 'seconds' | 'minutes';
export interface ExerciseEntry {
  name: string;
  category: ExerciseCategory;
  unit: ExerciseUnit;
  values: number[];
}
export interface WorkoutInput {
  performed_on: string;
  back_feeling: number;
  exercises: ExerciseEntry[];
}
export interface Workout extends WorkoutInput {
  id: string;
  user_id: string;
  created_at: string;
}
export const EXERCISES: Omit<ExerciseEntry, 'values'>[] = [
  { name: 'Plank', category: 'strength', unit: 'seconds' },
  { name: 'Glute bridge', category: 'strength', unit: 'reps' },
  { name: 'Deadlift', category: 'strength', unit: 'reps' },
  ...['Yoga', 'Pilates', 'Cycling', 'Swimming', 'Sport'].map(name => ({
    name, category: 'other' as const, unit: 'minutes' as const,
  })),
];
export const FEELINGS = ['Stiff', 'A little stiff', 'Okay', 'Good', 'Great'];

export function validateWorkout(input: WorkoutInput, today = toLocalDateKey()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.performed_on) ||
      toLocalDateKey(fromLocalDateKey(input.performed_on)) !== input.performed_on ||
      input.performed_on < '1900-01-01' || input.performed_on > today) {
    return 'Choose a valid date, today or earlier.';
  }
  if (!Number.isInteger(input.back_feeling) || input.back_feeling < 1 || input.back_feeling > 5) {
    return 'Choose how your back felt, from 1 to 5.';
  }
  if (!input.exercises.length || input.exercises.length > 30) return 'Add between 1 and 30 exercises.';
  for (const exercise of input.exercises) {
    if (!exercise.name.trim() || exercise.name.trim().length > 80) return 'Give each exercise a name (up to 80 characters).';
    if (!['strength', 'other'].includes(exercise.category) ||
        (exercise.category === 'strength' ? !['reps', 'seconds'].includes(exercise.unit) : exercise.unit !== 'minutes')) {
      return 'Choose reps or seconds for strength, and minutes for other activities.';
    }
    if (!exercise.values.length || exercise.values.length > 50 ||
        (exercise.unit === 'minutes' && exercise.values.length !== 1)) return 'Add between 1 and 50 sets, or one duration.';
    if (exercise.values.some(value => !Number.isFinite(value) || value <= 0 || value > 10000 ||
        (exercise.unit !== 'minutes' && !Number.isInteger(value)))) {
      return 'Enter positive amounts up to 10,000; reps and seconds must be whole numbers.';
    }
  }
  return null;
}

export function formatAmount(exercise: ExerciseEntry): string {
  const unit = { reps: 'reps', seconds: 'sec', minutes: 'min' }[exercise.unit];
  if (exercise.unit === 'minutes') return `${exercise.values[0]} min`;
  if (exercise.values.every(value => value === exercise.values[0])) return `${exercise.values.length} × ${exercise.values[0]} ${unit}`;
  return `${exercise.values.join(' / ')} ${unit}`;
}

export function repeatWorkout(workout: Workout): WorkoutInput {
  return {
    performed_on: toLocalDateKey(),
    back_feeling: 0,
    exercises: workout.exercises.map(exercise => ({ ...exercise, values: [...exercise.values] })),
  };
}
