import { supabase } from '@/src/lib/supabase';
import { validateWorkout, type Workout, type WorkoutInput } from '@/src/features/exercise/model';

const COLUMNS = 'id,user_id,performed_on,back_feeling,exercises,created_at';
export async function fetchWorkouts(userId: string): Promise<Workout[]> {
  // Page through history instead of silently dropping entries at the API row limit.
  const workouts: Workout[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('exercise_workouts').select(COLUMNS)
      .eq('user_id', userId).order('performed_on', { ascending: false })
      .order('created_at', { ascending: false }).order('id').range(offset, offset + 499);
    if (error) throw error;
    workouts.push(...(data as Workout[]));
    if (data.length < 500) return workouts;
  }
}
export async function saveWorkout(userId: string, input: WorkoutInput, id?: string): Promise<Workout> {
  const validation = validateWorkout(input);
  if (validation) throw new Error(validation);
  const payload = {
    performed_on: input.performed_on,
    back_feeling: input.back_feeling,
    exercises: input.exercises.map(exercise => ({ ...exercise, name: exercise.name.trim() })),
  };
  const query = id
    ? supabase.from('exercise_workouts').update(payload).eq('id', id).eq('user_id', userId)
    : supabase.from('exercise_workouts').insert({ ...payload, user_id: userId });
  const { data, error } = await query.select(COLUMNS).single();
  if (error) throw error;
  return data as Workout;
}
export async function deleteWorkout(userId: string, id: string): Promise<void> {
  const { error } = await supabase.from('exercise_workouts').delete()
    .eq('id', id).eq('user_id', userId).select('id').single();
  if (error) throw error;
}
