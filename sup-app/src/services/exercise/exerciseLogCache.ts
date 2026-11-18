import { fetchWorkouts } from '@/src/services/exercise/exerciseLogService';
import { fetchPostureCheckins, type PostureCheckin } from '@/src/services/posture/postureCheckinService';
import type { Workout } from '@/src/features/exercise/model';

/**
 * In-memory cache for the Exercise page: the signed-in user's workouts and
 * posture check-ins. Filled in the background right after login
 * (ExerciseLogPrefetch), so the page can show them instantly when opened and
 * then refresh quietly. One account at a time; cleared on sign-out.
 */

type Kind = 'workouts' | 'checkins';
type Rows = { workouts: Workout[]; checkins: PostureCheckin[] };

let owner: string | null = null;
const rows: Partial<Rows> = {};
const inFlight: Partial<Record<Kind, Promise<unknown>>> = {};

const fetchers: { [K in Kind]: (userId: string) => Promise<Rows[K]> } = {
  workouts: (userId) => fetchWorkouts(userId),
  checkins: (userId) => fetchPostureCheckins(userId),
};

function switchAccount(userId: string) {
  if (owner === userId) return;
  owner = userId;
  delete rows.workouts; delete rows.checkins;
  delete inFlight.workouts; delete inFlight.checkins;
}

function cached<K extends Kind>(kind: K, userId: string): Rows[K] | null {
  return owner === userId ? (rows[kind] as Rows[K] | undefined) ?? null : null;
}

/**
 * Fetches fresh rows. Joins a request already in flight for the same account
 * (e.g. the login prefetch) unless `force` is set, as for a pull-to-refresh.
 */
function load<K extends Kind>(kind: K, userId: string, force = false): Promise<Rows[K]> {
  switchAccount(userId);
  const pending = inFlight[kind] as Promise<Rows[K]> | undefined;
  if (pending && !force) return pending;
  const request = fetchers[kind](userId).then(
    (result) => { if (owner === userId) rows[kind] = result as Rows[typeof kind]; return result; },
  ).finally(() => { if (inFlight[kind] === request) delete inFlight[kind]; });
  inFlight[kind] = request;
  return request;
}

function store<K extends Kind>(kind: K, userId: string, value: Rows[K]) {
  switchAccount(userId);
  rows[kind] = value as Rows[typeof kind];
}

export const getCachedWorkouts = (userId: string) => cached('workouts', userId);
export const getCachedCheckins = (userId: string) => cached('checkins', userId);
export const loadWorkouts = (userId: string, force = false) => load('workouts', userId, force);
export const loadCheckins = (userId: string, force = false) => load('checkins', userId, force);
/** Keep the cache in step after a save or delete on the page. */
export const setCachedWorkouts = (userId: string, value: Workout[]) => store('workouts', userId, value);
export const setCachedCheckins = (userId: string, value: PostureCheckin[]) => store('checkins', userId, value);

/** Warm both lists after login. Errors are ignored here; the page reports its own. */
export function prefetchExerciseLog(userId: string): void {
  loadWorkouts(userId).catch(() => {});
  loadCheckins(userId).catch(() => {});
}

export function clearExerciseLogCache(): void {
  owner = null;
  delete rows.workouts; delete rows.checkins;
  delete inFlight.workouts; delete inFlight.checkins;
}
