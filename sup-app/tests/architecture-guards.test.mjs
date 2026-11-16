// Static guards for the "don't reintroduce this" rules in CLAUDE.md. Each one
// has been broken before (or would fail silently on a device), so they are
// checked on the source rather than left to code review.
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { ROOT, read } from './helpers/harness.mjs';

function appFiles(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return appFiles(rel);
    return /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}
const CLIENT_FILES = ['app', 'src', 'constants'].flatMap(appFiles);
// Code only — comments that explain a past mistake are allowed to name it.
const code = (rel) => ts.transpile(read(rel), { removeComments: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 });
const offenders = (pattern) => CLIENT_FILES.filter((f) => pattern.test(code(f))).map((f) => relative(ROOT, join(ROOT, f)));

test('the app never calls Anthropic directly — s\'kipper goes through the session-coach Edge Function', () => {
  assert.deepEqual(offenders(/api\.anthropic\.com|@anthropic-ai\/sdk|ANTHROPIC_API_KEY/), []);
  assert.match(code('src/services/ai/claudeProvider.ts'), /supabase\.functions\.invoke\("session-coach"/);
});

test('only public-by-design EXPO_PUBLIC_* variables are read by the client bundle', () => {
  const allowed = new Set(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SENTRY_DSN']);
  const used = new Set(CLIENT_FILES.flatMap((f) => code(f).match(/EXPO_PUBLIC_[A-Z0-9_]+/g) ?? []));
  assert.deepEqual([...used].filter((v) => !allowed.has(v)), [], 'new EXPO_PUBLIC_* vars ship in the app — never put a secret there');
  assert.deepEqual(offenders(/SERVICE_ROLE|service_role/), []);
});

test('BLE scanning filters by service UUID only, never by device-name prefix', () => {
  const ble = code('src/services/BLEService.ts');
  assert.match(ble, /startDeviceScan\(\s*\[SERVICE_UUID\]/);
  assert.doesNotMatch(ble, /name\??\.(startsWith|includes|match)\(/);
});

test('pairing matches by advertised name, never by MAC/UUID', () => {
  assert.doesNotMatch(code('src/lib/qrPairing.ts'), /mac|uuid/i);
});

test('provider order: Auth → … → IMUProvider wraps the Stack, with SessionStats inside it', () => {
  const layout = read('app/_layout.tsx');
  const pos = (tag) => { const i = layout.indexOf(`<${tag}>`); assert.ok(i >= 0, `${tag} missing`); return i; };
  assert.ok(pos('AuthProvider') < pos('OnboardingProvider'));
  assert.ok(pos('OnboardingProvider') < pos('TutorialProvider'));
  assert.ok(pos('TutorialProvider') < pos('ToastProvider'));
  assert.ok(pos('ToastProvider') < pos('IMUProvider'));
  assert.ok(pos('IMUProvider') < pos('SessionStatsProvider'));
  assert.ok(pos('SessionStatsProvider') < layout.indexOf('<Stack'));
});

test('BLE background mode stays enabled (keeps sessions alive with the screen locked on iOS)', () => {
  const plugins = JSON.parse(read('app.json')).expo.plugins;
  const ble = plugins.find((p) => Array.isArray(p) && p[0] === 'react-native-ble-plx');
  assert.ok(ble, 'react-native-ble-plx config plugin missing');
  assert.equal(ble[1].isBackgroundEnabled, true);
  assert.ok(ble[1].modes.includes('central'));
});

test('posture thresholds are never personalised from calibrated ranges', () => {
  const parser = read('src/lib/imuParser.ts');
  const classifier = parser.slice(parser.indexOf('export function classifySpinePosture'), parser.indexOf('export function createPostureStabilizer'));
  const body = ts.transpile(classifier, { removeComments: true });
  assert.doesNotMatch(body, /max(Forward|Backward|Right|Left)Deg/);
});

test('posture_daily dates come from the device-local day helper, not toISOString()', () => {
  for (const f of ['src/services/posture/postureSyncService.ts', 'src/contexts/IMUContext.tsx', 'app/(tabs)/stats.tsx']) {
    assert.doesNotMatch(code(f), /toISOString\(\)\.slice\(0,\s*10\)|toISOString\(\)\.split\("T"\)/, f);
  }
});
