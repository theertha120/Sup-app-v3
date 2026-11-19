// generate-daily-summaries Edge Function (Deno, cron-triggered), run under
// Node with Deno.serve / Deno.env / Supabase / the Anthropic API faked.
// It runs unattended, so a break here wouldn't show up in the app for a day.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eqs, fakeClock, fakeSupabase, flush, loadTs, opArg, quietConsole } from './helpers/harness.mjs';

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const SELF = 'https://project.supabase.co/functions/v1/generate-daily-summaries';
const MIN = 60_000;
// 00:00 UTC on 13 Nov = 08:00 SGT on 13 Nov.
const EIGHT_AM_SGT = Date.UTC(2026, 10, 13, 0, 0);

function cron({
  at = EIGHT_AM_SGT, users = ['u1', 'u2'], existing = [], posture = {}, claude, secret = 'cron-secret', edgeRuntime = false, handoff,
} = {}) {
  const clock = fakeClock(at);
  const upserts = [];
  const db = fakeSupabase((q) => {
    if (q.table === 'user_profile') {
      const [, from, to] = q.ops.find(([m]) => m === 'range');
      return { data: users.slice(from, to + 1).map((id) => ({ id })), error: null };
    }
    if (q.table === 'daily_ai_summary' && opArg(q, 'upsert')) { upserts.push(opArg(q, 'upsert')); return { error: null }; }
    if (q.table === 'daily_ai_summary') return { data: existing.includes(eqs(q).user_id) ? { user_id: eqs(q).user_id } : null, error: null };
    if (q.table === 'posture_daily') {
      const uid = eqs(q).user_id;
      const rows = posture[uid] ?? [{ date: '2026-11-12', state_totals: { upright: 30 * MIN, slouched: 10 * MIN }, xp: 30, total_desk_ms: 40 * MIN }];
      return { data: rows, error: null };
    }
    return { data: null, error: null };
  });
  const prompts = [];
  const handoffs = [];
  let claudeCalls = 0;
  const fetch = async (url, init) => {
    if (url === ANTHROPIC) {
      claudeCalls++;
      prompts.push(JSON.parse(init.body).messages[0].content);
      const r = claude ? claude(claudeCalls, init) : null;
      if (r) return r;
      return new Response(JSON.stringify({ content: [{ text: 'Answer 1: you sat tall on thursday.\nAnswer 2: 75% good alignment. today\'s focus: sit tall.' }] }), { status: 200 });
    }
    if (url === SELF) {
      handoffs.push({ body: JSON.parse(init.body), auth: init.headers.Authorization });
      return handoff ? handoff(handoffs.length) : new Response('{}', { status: 202 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  let handler = null;
  const waited = [];
  const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', ANTHROPIC_API_KEY: 'sk-test', CRON_SECRET: secret };
  loadTs('supabase/functions/generate-daily-summaries/index.ts', {
    mocks: { 'npm:@supabase/supabase-js@2': { createClient: () => db.client } },
    globals: {
      Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
      fetch, Date: clock.Date, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, console: quietConsole,
      ...(edgeRuntime && { EdgeRuntime: { waitUntil: (p) => waited.push(p) } }),
    },
  });
  const call = async (body = {}, auth = `Bearer ${secret}`) => {
    const p = handler(new Request('https://x/', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(body) }));
    let done = false;
    p.then(() => { done = true; }, () => { done = true; });
    for (let i = 0; i < 2000 && !done; i++) { await flush(1); clock.advance(100); }
    const res = await p;
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { call, db, upserts, prompts, handoffs, waited, clock, claudeCalls: () => claudeCalls };
}

test('rejects calls without the cron secret', async () => {
  const c = cron();
  assert.equal((await c.call({}, 'Bearer wrong')).status, 401);
  assert.equal(c.db.queries.length, 0);
});

test('any hour other than 8am Singapore time is a no-op', async () => {
  const c = cron({ at: Date.UTC(2026, 10, 13, 1, 0) }); // 09:00 SGT
  const r = await c.call();
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.ok, r.json.skipped, r.json.error], [0, 0, 0]);
  assert.equal(c.db.queries.length, 0);
  assert.equal(c.claudeCalls(), 0);
});

test('at 8am SGT every user gets a summary dated by the SGT day, parsed into insight + note', async () => {
  const c = cron();
  const r = await c.call();
  assert.deepEqual([r.json.ok, r.json.skipped, r.json.error], [2, 0, 0]);
  assert.equal(c.upserts.length, 2);
  for (const row of c.upserts) {
    assert.equal(row.date, '2026-11-13');
    assert.equal(row.insight, 'you sat tall on thursday.');
    assert.equal(row.concised_summary, "75% good alignment. today's focus: sit tall.");
  }
  assert.deepEqual(c.upserts.map((u) => u.user_id).sort(), ['u1', 'u2']);
});

test('the date is the Singapore day even when it is still the previous day in UTC', async () => {
  // 23:30 UTC on the 12th = 07:30 SGT on the 13th (cron passes hour 8 explicitly).
  const c = cron({ at: Date.UTC(2026, 10, 12, 23, 30), users: ['u1'] });
  await c.call({ hour: 8 });
  assert.equal(c.upserts[0].date, '2026-11-13');
});

test('each summary reads the 7 days ending today and puts the real numbers in the prompt', async () => {
  const c = cron({ users: ['u1'] });
  await c.call();
  const q = c.db.queries.find((x) => x.table === 'posture_daily');
  assert.deepEqual(q.ops.find(([m]) => m === 'in')[2],
    ['2026-11-13', '2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09', '2026-11-08', '2026-11-07']);
  const prompt = c.prompts[0];
  assert.match(prompt, /It is the morning of 2026-11-13/);
  // XP replaced the s'up s'core in the prompt (docs/xp.md).
  assert.match(prompt, /Thursday 2026-11-12: tracked 40 min, 30 XP\. good alignment 30 min \(75%\), slouched 10 min \(25%\)/);
  assert.match(prompt, /habit costing the most: slouched/);
  assert.equal(q.ops.find(([m]) => m === 'select')[1], 'date, state_totals, xp, total_desk_ms');
  assert.doesNotMatch(prompt, /s'core/, 'the retired s’core is no longer mentioned');
});

test('days with XP but no tracked session (check-in / workout only) are not counted as tracked days', async () => {
  const c = cron({ users: ['u1'], posture: { u1: [
    { date: '2026-11-11', state_totals: { upright: 20 * MIN }, xp: 10, total_desk_ms: 20 * MIN },
    { date: '2026-11-12', state_totals: {}, xp: 20, total_desk_ms: 0 },
  ] } });
  await c.call();
  const prompt = c.prompts[0];
  assert.match(prompt, /days tracked: 1 of 7/);
  assert.match(prompt, /only one tracked day, no trend yet/);
  assert.match(prompt, /most XP 2026-11-12 \(20 XP\)/);
});

test('re-running the same day is idempotent; users with no tracking are skipped', async () => {
  const c = cron({ users: ['done', 'idle', 'new'], existing: ['done'], posture: { idle: [] } });
  const r = await c.call();
  assert.deepEqual([r.json.ok, r.json.skipped, r.json.error], [1, 2, 0]);
  assert.deepEqual(c.upserts.map((u) => u.user_id), ['new']);
  assert.equal(c.claudeCalls(), 1);
});

test('rate limits and overloads are retried (honouring retry-after); a hard failure only fails that user', async () => {
  const c = cron({ users: ['u1'], claude: (n) => (n === 1 ? new Response('slow down', { status: 429, headers: { 'retry-after': '2' } })
    : n === 2 ? new Response('overloaded', { status: 529 }) : null) });
  const r = await c.call();
  assert.equal(r.json.ok, 1);
  assert.equal(c.claudeCalls(), 3);

  const bad = cron({ users: ['u1', 'u2'], claude: (_n, init) => (JSON.parse(init.body).messages[0].content && bad.claudeCalls() === 1
    ? new Response('bad request', { status: 400 }) : null) });
  const r2 = await bad.call();
  assert.deepEqual([r2.json.ok, r2.json.error], [1, 1], 'a 400 is not retried, and the other user still gets theirs');
});

test('more than 1000 users are all fetched (paged), and over 200 are handed to a continuation', async () => {
  const users = Array.from({ length: 1005 }, (_, i) => `u${String(i).padStart(4, '0')}`);
  const c = cron({ users });
  const r = await c.call();
  const pages = c.db.queries.filter((q) => q.table === 'user_profile').map((q) => q.ops.find(([m]) => m === 'range').slice(1));
  assert.deepEqual(pages, [[0, 999], [1000, 1999]]);
  assert.equal(r.json.ok, 200, 'this invocation only processes the first 200');
  assert.equal(c.handoffs.length, 1);
  assert.equal(c.handoffs[0].body.userIds.length, 805);
  assert.equal(c.handoffs[0].body.userIds[0], 'u0200');
  assert.equal(c.handoffs[0].auth, 'Bearer cron-secret');
});

test('a continuation processes exactly the users it was handed, without re-reading the user list', async () => {
  const c = cron();
  const r = await c.call({ hour: 8, userIds: ['x1', 'x2', 'x3'] });
  assert.equal(r.json.ok, 3);
  assert.equal(c.db.queries.filter((q) => q.table === 'user_profile').length, 0);
  assert.deepEqual(c.upserts.map((u) => u.user_id).sort(), ['x1', 'x2', 'x3']);
});

test('a refused hand-off is retried', async () => {
  const users = Array.from({ length: 201 }, (_, i) => `u${i}`);
  const c = cron({ users, handoff: (n) => new Response('{}', { status: n < 3 ? 503 : 202 }) });
  await c.call();
  assert.equal(c.handoffs.length, 3);
});

test('on Supabase (EdgeRuntime) the cron gets an immediate 202 and the work continues in the background', async () => {
  const c = cron({ edgeRuntime: true });
  const r = await c.call();
  assert.equal(r.status, 202);
  assert.equal(r.json.accepted, 2);
  assert.equal(c.waited.length, 1);
  for (let i = 0; i < 50; i++) { await flush(1); c.clock.advance(100); }
  await c.waited[0];
  assert.equal(c.upserts.length, 2);
});
