// Sign-in, sign-up and account flows: AuthContext, the post-verification
// profile save (verify-email.tsx) and startup routing (app/index.tsx), all
// against a fake Supabase auth client.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  eqs, extractHandlers, fakeAsyncStorage, fakeSentry, fakeSupabase, flush, loadTs, miniReact, opArg, quietConsole,
} from './helpers/harness.mjs';

const ENV = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key' };

/** Supabase auth stand-in: every call is recorded; results come from `results`. */
function fakeAuth(results = {}) {
  const calls = [];
  let listener = null;
  const call = (name) => async (...args) => {
    calls.push([name, ...args]);
    const r = results[name];
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(...args) : (r ?? { data: {}, error: null });
  };
  return {
    calls,
    emit: (event, session) => listener?.(event, session),
    auth: {
      getUser: call('getUser'),
      getSession: call('getSession'),
      signInWithPassword: call('signInWithPassword'),
      signUp: call('signUp'),
      verifyOtp: call('verifyOtp'),
      resetPasswordForEmail: call('resetPasswordForEmail'),
      updateUser: call('updateUser'),
      signOut: call('signOut'),
      onAuthStateChange: (cb) => { listener = cb; return { data: { subscription: { unsubscribe() {} } } }; },
    },
  };
}

// ── AuthContext ─────────────────────────────────────────────────────────────

function authProvider({ results = {}, fetch } = {}) {
  const fa = fakeAuth({ getUser: { data: { user: null }, error: null }, ...results });
  const db = fakeSupabase();
  db.client.auth = fa.auth;
  const sentry = fakeSentry();
  const storage = fakeAsyncStorage({ some_cached_key: 'x' });
  storage.clear = async () => { storage.store.clear(); };
  storage.default.clear = storage.clear;
  const streakChecks = [];
  const timezoneSaves = [];
  const appState = [];
  const fetches = [];
  const { react, mount } = miniReact();
  const mod = loadTs('src/contexts/AuthContext.tsx', {
    mocks: {
      react,
      'react-native': { AppState: { addEventListener: (_e, cb) => { appState.push(cb); return { remove() {} }; } } },
      '@react-native-async-storage/async-storage': storage,
      '@/constants/env': ENV,
      '@/src/lib/supabase': db.module,
      '@/src/lib/sentry': sentry.module,
      '@/src/services/user/timezoneService': { autoDetectAndSaveTimezone: (uid) => timezoneSaves.push(uid) },
      '@/src/services/posture/postureSyncService': { checkStreakOnAppOpen: async (uid) => { streakChecks.push(uid); } },
    },
    globals: {
      console: quietConsole,
      fetch: async (url, init) => { fetches.push({ url, init }); return fetch ? fetch(url, init) : new Response('{}'); },
    },
  });
  const provider = mount(() => mod.AuthProvider({ children: null }));
  let tree = provider.render();
  const rerender = () => { tree = provider.render(); };
  const ctx = () => tree.props.value;
  const toState = (s) => { appState.forEach((cb) => cb(s)); };
  return { ctx, rerender, fa, sentry, storage, streakChecks, timezoneSaves, fetches, toState };
}
const signedIn = (id = 'user-1') => ({ getUser: { data: { user: { id } }, error: null } });

test('startup with a saved login signs the user in, checks the streak and saves the timezone', async () => {
  const a = authProvider({ results: signedIn() });
  await flush(); a.rerender();
  assert.equal(a.ctx().isAuthenticated, true);
  assert.equal(a.ctx().userId, 'user-1');
  assert.deepEqual(a.streakChecks, ['user-1']);
  assert.equal(a.ctx().streakVersion, 1, 'header streak is told to refetch');
  assert.deepEqual(a.timezoneSaves, ['user-1']);
});

test('startup with no login stays signed out and touches nothing', async () => {
  const a = authProvider();
  await flush(); a.rerender();
  assert.equal(a.ctx().isAuthenticated, false);
  assert.equal(a.ctx().userId, null);
  assert.deepEqual(a.streakChecks, []);
  assert.deepEqual(a.timezoneSaves, []);
});

test('a failing startup check is reported and leaves the user signed out', async () => {
  const a = authProvider({ results: { getUser: new Error('offline') } });
  await flush(); a.rerender();
  assert.equal(a.ctx().isAuthenticated, false);
  assert.ok(a.sentry.errors.some((e) => e.context === 'auth-startup'));
});

test('auth events keep state in sync; a fresh sign-in checks the streak and ends registration mode', async () => {
  const a = authProvider();
  await flush(); a.rerender();
  a.ctx().startRegistration(); a.rerender();
  assert.equal(a.ctx().registrationMode, true);
  a.fa.emit('SIGNED_IN', { user: { id: 'user-2' } });
  await flush(); a.rerender();
  assert.deepEqual([a.ctx().isAuthenticated, a.ctx().userId, a.ctx().registrationMode], [true, 'user-2', false]);
  assert.deepEqual(a.streakChecks, ['user-2']);
  a.fa.emit('TOKEN_REFRESHED', { user: { id: 'user-2' } });
  await flush();
  assert.deepEqual(a.streakChecks, ['user-2'], 'token refreshes are not a new app open');
  a.fa.emit('SIGNED_OUT', null);
  a.rerender();
  assert.deepEqual([a.ctx().isAuthenticated, a.ctx().userId], [false, null]);
});

test('coming back from the background re-checks the streak (but just switching apps briefly via inactive does not)', async () => {
  const a = authProvider({ results: signedIn() });
  await flush(); a.rerender();
  a.toState('inactive'); a.toState('active');
  await flush();
  assert.deepEqual(a.streakChecks, ['user-1']);
  a.toState('background'); a.toState('active');
  await flush();
  assert.deepEqual(a.streakChecks, ['user-1', 'user-1']);
});

test('login: success, wrong password (not sent to Sentry) and unexpected errors (sent)', async () => {
  const a = authProvider({ results: { signInWithPassword: ({ password }) => (password === 'right'
    ? { data: { user: { id: 'u' } }, error: null }
    : password === 'wrong'
      ? { data: { user: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } }
      : { data: { user: null }, error: { code: 'unexpected_failure', message: 'boom' } }) } });
  assert.deepEqual(await a.ctx().login('a@b.co', 'right'), { success: true });
  assert.deepEqual(await a.ctx().login('a@b.co', 'wrong'), { success: false, error: 'Invalid login credentials' });
  assert.equal(a.sentry.errors.length, 0, 'user mistakes stay out of Sentry');
  assert.equal((await a.ctx().login('a@b.co', 'other')).success, false);
  assert.ok(a.sentry.errors.some((e) => e.context === 'login'));
});

test('register needs a returned user; codes are verified as signup vs recovery', async () => {
  const a = authProvider({ results: {
    signUp: { data: { user: null }, error: null },
    verifyOtp: { data: { user: { id: 'u' } }, error: null },
  } });
  assert.deepEqual(await a.ctx().register('a@b.co', 'pw123456'), { success: false, error: 'No user returned from signUp' });
  assert.equal((await a.ctx().verifyEmailOtp('a@b.co', '123456')).success, true);
  assert.equal((await a.ctx().verifyPasswordResetOtp('a@b.co', '654321')).success, true);
  const types = a.fa.calls.filter(([n]) => n === 'verifyOtp').map(([, args]) => args.type);
  assert.deepEqual(types, ['signup', 'recovery']);
});

test('an expired code is a readable error, never a crash', async () => {
  const a = authProvider({ results: { verifyOtp: { data: { user: null }, error: { code: 'otp_expired', message: 'Token has expired' } } } });
  assert.deepEqual(await a.ctx().verifyEmailOtp('a@b.co', '000000'), { success: false, error: 'Token has expired' });
  assert.equal(a.sentry.errors.length, 0);
});

test('logout always ends up signed out, even if Supabase sign-out fails', async () => {
  const a = authProvider({ results: { ...signedIn(), signOut: new Error('network') } });
  await flush(); a.rerender();
  await a.ctx().logout();
  a.rerender();
  assert.deepEqual([a.ctx().isAuthenticated, a.ctx().userId], [false, null]);
  assert.ok(a.sentry.errors.some((e) => e.context === 'logout'));
});

test('delete account: calls the Edge Function with the user\'s token, then wipes local data and signs out', async () => {
  const a = authProvider({
    results: { ...signedIn(), getSession: { data: { session: { access_token: 'jwt-123' } } } },
    fetch: async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
  });
  await flush(); a.rerender();
  assert.deepEqual(await a.ctx().deleteAccount(), { success: true });
  a.rerender();
  const [req] = a.fetches;
  assert.equal(req.url, 'https://project.supabase.co/functions/v1/delete-account');
  assert.equal(req.init.headers.Authorization, 'Bearer jwt-123');
  assert.equal(req.init.headers.apikey, 'anon-key');
  assert.equal(a.storage.store.size, 0, 'on-device data for the deleted account is cleared');
  assert.ok(a.fa.calls.some(([n]) => n === 'signOut'));
  assert.equal(a.ctx().isAuthenticated, false);
});

test('delete account: a server failure keeps the user signed in with their data', async () => {
  const a = authProvider({
    results: { ...signedIn(), getSession: { data: { session: { access_token: 'jwt-123' } } } },
    fetch: async () => new Response(JSON.stringify({ error: 'could not delete' }), { status: 500 }),
  });
  await flush(); a.rerender();
  assert.deepEqual(await a.ctx().deleteAccount(), { success: false, error: 'could not delete' });
  a.rerender();
  assert.equal(a.storage.store.size, 1);
  assert.equal(a.ctx().isAuthenticated, true);
});

test('delete account without a session never calls the server', async () => {
  const a = authProvider({ results: { getSession: { data: { session: null } } } });
  const r = await a.ctx().deleteAccount();
  assert.equal(r.success, false);
  assert.equal(a.fetches.length, 0);
});

// ── Sign-up: verify the code, then create the profile rows ─────────────────

function verifyScreen({ verify = { success: true }, user = { id: 'new-user' }, insertError = null, upsertError = null, updateUser = { error: null } } = {}) {
  const fa = fakeAuth({ getUser: { data: { user } }, updateUser });
  const db = fakeSupabase((q) => {
    if (q.table === 'profiles') return { data: null, error: insertError };
    if (q.table === 'user_profile') return { data: null, error: upsertError };
    return { data: null, error: null };
  });
  db.client.auth = fa.auth;
  const sentry = fakeSentry();
  const { createDefaultBehaviorProfile } = loadTs('src/services/user/behaviorProfileService.ts', {
    mocks: { '@/src/lib/supabase': db.module, '@/src/lib/sentry': sentry.module },
  });
  const ui = { error: '', verifying: false, saveFailed: false, routes: [], pending: null, codes: [] };
  const pendingSignup = { firstName: 'Ana', lastName: 'Lee', email: 'ana@example.com', username: 'ana', password: 'pw123456' };
  const h = extractHandlers('app/onboarding/verify-email.tsx', ['saveProfile', 'handleVerify'], {
    supabase: db.client, captureError: sentry.module.captureError, console: quietConsole,
    createDefaultBehaviorProfile, randomAvatarUrl: () => 'supsona:abc',
    router: { push: (r) => ui.routes.push(r) },
    pendingSignup, answers: { howHeard: 'friend' },
    verifying: false, verifyEmailOtp: async (email, code) => { ui.codes.push([email, code]); return verify; },
    setVerifying: (v) => { ui.verifying = v; }, setError: (e) => { ui.error = e; },
    setSaveFailed: (v) => { ui.saveFailed = v; }, setCode() {}, setPendingSignup: (p) => { ui.pending = p; },
  });
  return { h, ui, db, fa, sentry };
}

test('a correct code creates the profile and coaching defaults, then continues onboarding', async () => {
  const v = verifyScreen();
  await v.h.handleVerify('123456');
  assert.deepEqual(v.ui.codes, [['ana@example.com', '123456']]);
  assert.equal(v.ui.pending.password, '', 'the password is not kept in memory after use');
  const profile = opArg(v.db.queries.find((q) => q.table === 'profiles'), 'insert');
  assert.deepEqual(
    [profile.id, profile.name, profile.last_name, profile.username, profile.current_streak, profile.how_heard],
    ['new-user', 'Ana', 'Lee', 'ana', 0, 'friend'],
  );
  const behaviour = opArg(v.db.queries.find((q) => q.table === 'user_profile'), 'upsert');
  assert.equal(behaviour.id, 'new-user');
  assert.equal(behaviour.reminder_frequency, 'light');
  assert.deepEqual(v.ui.routes, ['/onboarding/final']);
  assert.equal(v.ui.verifying, false);
});

test('a wrong code shows the error and creates nothing', async () => {
  const v = verifyScreen({ verify: { success: false, error: 'Token has expired' } });
  await v.h.handleVerify('000000');
  assert.equal(v.ui.error, 'Token has expired');
  assert.equal(v.db.queries.length, 0);
  assert.deepEqual(v.ui.routes, []);
});

test('retrying after a partial save treats an existing profile row as already saved', async () => {
  const v = verifyScreen({ insertError: { code: '23505', message: 'duplicate key' } });
  await v.h.saveProfile();
  assert.deepEqual(v.ui.routes, ['/onboarding/final']);
});

test('a failed profile save shows a retry state instead of moving on', async () => {
  for (const opts of [{ insertError: { code: '42501', message: 'rls' } }, { upsertError: { message: 'down' } }, { user: null }]) {
    const v = verifyScreen(opts);
    await v.h.saveProfile();
    assert.deepEqual(v.ui.routes, [], JSON.stringify(opts));
    assert.equal(v.ui.saveFailed, true);
    assert.match(v.ui.error, /couldn't save your profile/);
    assert.equal(v.ui.verifying, false, 'button is not left stuck on "verifying..."');
  }
});

test('re-applying the password is best-effort: "same password" is silent, other failures are reported but not fatal', async () => {
  const same = verifyScreen({ updateUser: { error: { code: 'same_password' } } });
  await same.h.handleVerify('123456');
  assert.equal(same.sentry.errors.length, 0);
  assert.deepEqual(same.ui.routes, ['/onboarding/final']);
  const other = verifyScreen({ updateUser: { error: { code: 'unexpected_failure' } } });
  await other.h.handleVerify('123456');
  assert.ok(other.sentry.errors.some((e) => e.context === 'signup-apply-password'));
  assert.deepEqual(other.ui.routes, ['/onboarding/final']);
});

// ── Startup routing (app/index.tsx) ─────────────────────────────────────────

async function startupDestination({ getUser, profile }) {
  const fa = fakeAuth({ getUser });
  const db = fakeSupabase((q) => (q.table === 'profiles' ? profile : { data: null }));
  db.client.auth = fa.auth;
  const sentry = fakeSentry();
  const { react, mount } = miniReact();
  const { default: Index } = loadTs('app/index.tsx', {
    mocks: { react, 'expo-router': { Redirect: 'Redirect' }, '../src/lib/supabase': db.module, '../src/lib/sentry': sentry.module },
    globals: { console: quietConsole },
  });
  const screen = mount(() => Index());
  assert.equal(screen.render(), null, 'renders nothing until the check finishes');
  await flush();
  const out = screen.render();
  return { href: out?.props.href, signOuts: fa.calls.filter(([n]) => n === 'signOut').map(([, a]) => a), sentry };
}
const user = { data: { user: { id: 'u1' } }, error: null };

test('startup: signed out → home', async () => {
  const r = await startupDestination({ getUser: { data: { user: null }, error: null } });
  assert.equal(r.href, '/(tabs)/home');
  assert.deepEqual(r.signOuts, []);
});

test('startup: a saved login that is no longer valid is cleared locally → home', async () => {
  const r = await startupDestination({ getUser: { data: { user: null }, error: { message: 'User not found' } } });
  assert.equal(r.href, '/(tabs)/home');
  assert.deepEqual(r.signOuts, [{ scope: 'local' }]);
});

test('startup: not finished onboarding → intro; finished → home', async () => {
  assert.equal((await startupDestination({ getUser: user, profile: { data: { onboarding: false }, error: null } })).href, '/onboarding/intro');
  assert.equal((await startupDestination({ getUser: user, profile: { data: { onboarding: true }, error: null } })).href, '/(tabs)/home');
});

test('startup: signed in with no profile row (failed sign-up) is signed out and reported', async () => {
  const r = await startupDestination({ getUser: user, profile: { data: null, error: null } });
  assert.equal(r.href, '/(tabs)/home');
  assert.deepEqual(r.signOuts, [{ scope: 'local' }]);
  assert.ok(r.sentry.errors.some((e) => e.context === 'startup-missing-profile'));
});

test('startup: a profile read failure (offline) never signs out or forces onboarding', async () => {
  const r = await startupDestination({ getUser: user, profile: { data: null, error: { message: 'offline' } } });
  assert.equal(r.href, '/(tabs)/home');
  assert.deepEqual(r.signOuts, []);
});

// ── Profile service ─────────────────────────────────────────────────────────

function profileService({ respond, session = { user: { id: 'me' } }, storage = fakeAsyncStorage() } = {}) {
  const db = fakeSupabase(respond);
  db.client.auth = fakeAuth({ getSession: { data: { session }, error: null } }).auth;
  const sentry = fakeSentry();
  const svc = loadTs('src/services/user/profileService.ts', {
    mocks: { '@react-native-async-storage/async-storage': storage, '@/src/lib/supabase': db.module, '@/src/lib/sentry': sentry.module },
    globals: { console: quietConsole, __DEV__: false },
  });
  return { svc, db, sentry, storage };
}
const row = (over = {}) => ({
  id: 'me', name: 'Ana', username: 'ana', avatar_url: 'remote-avatar', current_streak: 3,
  last_activity_date: '2026-11-12', weekly_avg_points: '41.5', created_at: '2026-10-01T00:00:00Z', ...over,
});

test('username check is trimmed and case-insensitive, and fails open on a network error', async () => {
  const taken = profileService({ respond: () => ({ data: { id: 'x' }, error: null }) });
  assert.equal(await taken.svc.isUsernameTaken('  Ana  '), true);
  const q = taken.db.queries[0];
  assert.deepEqual(q.ops.find(([m]) => m === 'ilike'), ['ilike', 'username', 'Ana']);
  assert.equal(await taken.svc.isUsernameTaken('   '), false, 'blank is never "taken"');
  const down = profileService({ respond: () => ({ data: null, error: { message: 'offline' } }) });
  assert.equal(await down.svc.isUsernameTaken('ana'), false, 'a blip must not block sign-up');
  assert.ok(down.sentry.errors.some((e) => e.context === 'username-check'));
});

test('own profile maps safe defaults and prefers the locally saved supsona', async () => {
  const p = profileService({ respond: () => ({ data: row({ current_streak: null, weekly_avg_points: null, last_activity_date: null }), error: null }) });
  const me = await p.svc.fetchCurrentUserProfileWithStats();
  assert.deepEqual([me.currentStreak, me.weeklyAvgPoints, me.lastActivityDate, me.avatar], [0, 0, '', 'remote-avatar']);
  assert.equal(eqs(p.db.queries[0]).id, 'me');
  const withLocal = profileService({ respond: () => ({ data: row(), error: null }), storage: fakeAsyncStorage({ sup_app_supsona_me: 'local-avatar' }) });
  const me2 = await withLocal.svc.fetchCurrentUserProfileWithStats();
  assert.equal(me2.avatar, 'local-avatar');
  assert.equal(me2.weeklyAvgPoints, 41.5, 'numeric strings from Postgres become numbers');
});

test('no session means no profile, with no query made', async () => {
  const p = profileService({ session: null });
  assert.equal(await p.svc.fetchCurrentUserProfileWithStats(), null);
  assert.equal(await p.svc.updateCurrentUserProfile({ name: 'X' }), null);
  assert.equal(p.db.queries.length, 0);
});

test('updating your profile trims input, maps avatar → avatar_url, only targets your own row and notifies listeners', async () => {
  const p = profileService({ respond: (q) => ({ data: row({ ...opArg(q, 'update') }), error: null }) });
  const seen = [];
  const unsubscribe = p.svc.subscribeToProfileUpdates((prof) => seen.push(prof.name));
  const updated = await p.svc.updateCurrentUserProfile({ name: '  Ana B ', username: ' anab ', avatar: '  supsona:1 ' });
  const q = p.db.queries[0];
  assert.deepEqual(opArg(q, 'update'), { name: 'Ana B', username: 'anab', avatar_url: 'supsona:1' });
  assert.equal(eqs(q).id, 'me');
  assert.equal(updated.name, 'Ana B');
  assert.deepEqual(seen, ['Ana B']);
  assert.equal(p.storage.store.get('sup_app_supsona_me'), '  supsona:1 ', 'avatar is cached locally too');
  unsubscribe();
  await p.svc.updateCurrentUserProfile({ name: 'Again' });
  assert.deepEqual(seen, ['Ana B'], 'unsubscribed listeners are not called');
});

test('invalid profile updates are rejected before reaching the database', async () => {
  const p = profileService({ respond: () => ({ data: row(), error: null }) });
  await assert.rejects(p.svc.updateCurrentUserProfile({ name: '   ' }), /Name must be a non-empty string/);
  await assert.rejects(p.svc.updateCurrentUserProfile({ username: '' }), /Username must be a non-empty string/);
  await assert.rejects(p.svc.updateCurrentUserProfile({ avatar: 42 }), /Avatar must be a string URL or null/);
  await assert.rejects(p.svc.updateUserProfile('me', { current_streak: 99 }), /Cannot update fields: current_streak/);
  assert.equal(p.db.queries.length, 0);
});

test('a permission (RLS) failure becomes a clear message', async () => {
  const p = profileService({ respond: () => ({ data: null, error: { code: '42501', message: 'permission denied for table profiles' } }) });
  await assert.rejects(p.svc.updateCurrentUserProfile({ name: 'X' }), /You can only update your own profile/);
});

test('clearing the avatar stores null and removes the local copy', async () => {
  const p = profileService({ respond: () => ({ data: row({ avatar_url: null }), error: null }), storage: fakeAsyncStorage({ sup_app_supsona_me: 'old' }) });
  const updated = await p.svc.updateCurrentUserProfile({ avatar: null });
  assert.deepEqual(opArg(p.db.queries[0], 'update'), { avatar_url: null });
  assert.equal(p.storage.store.has('sup_app_supsona_me'), false);
  assert.equal(updated.avatar, undefined);
});
