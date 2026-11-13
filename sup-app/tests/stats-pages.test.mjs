// Stats screen bucketing (week / month / year pages), using the real helpers
// extracted from app/(tabs)/stats.tsx with a fixed "today".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toLocalDateKey } from '../src/lib/dateKey.ts';
import { extractDeclarations, fakeClock, fakeSentry, fakeSupabase, loadTs } from './helpers/harness.mjs';

const MIN = 60_000;
const { supScoreForRows } = loadTs('src/services/posture/postureSyncService.ts', {
  mocks: { '@/src/lib/supabase': fakeSupabase().module, '@/src/lib/sentry': fakeSentry().module },
});

function pagesFor(history, range, today = new Date(2026, 10, 13, 15, 0)) {
  const clock = fakeClock(today.getTime());
  const { buildPages } = extractDeclarations('app/(tabs)/stats.tsx', [
    'fmt', 'fmtFull', 'getPageCountFromRows', 'toDateKey', 'DAY_LABELS', 'emptyStateTotals',
    'accumulateStateTotals', 'periodScoreOf', 'sessionMinsOf', 'buildPages',
  ], { Date: clock.Date, toLocalDateKey, supScoreForRows });
  return buildPages(history, range);
}

const row = (date, uprightMin, slouchMin = 0) => ({
  date, totalDeskMs: (uprightMin + slouchMin) * MIN, totalMinutes: uprightMin + slouchMin, supScore: 70,
  stateTotals: { upright: uprightMin * MIN, slouched: slouchMin * MIN },
});

// ── week ────────────────────────────────────────────────────────────────────

test('week page is the 7 days ending today, each labelled by its real weekday', () => {
  const [page] = pagesFor([row('2026-11-13', 10)], 'week');
  // Fri 13 Nov 2026 → sat … fri
  assert.deepEqual(page.labels, ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']);
  assert.equal(page.pointDates[0], '7 nov 2026');
  assert.equal(page.pointDates[6], '13 nov 2026');
  assert.deepEqual(page.hasData, [false, false, false, false, false, false, true]);
  assert.equal(page.sessionMins[6], 10);
});

test('older week pages step back exactly 7 days and keep the same weekday order', () => {
  const history = [row('2026-03-01', 5), row('2026-11-13', 5)];
  const pages = pagesFor(history, 'week');
  for (let i = 1; i < pages.length; i++) {
    assert.deepEqual(pages[i].labels, pages[0].labels, `page ${i} keeps the same weekday order`);
  }
  assert.equal(pages[1].endDate, '6 nov');
});

// ── month (incl. wk 5) ──────────────────────────────────────────────────────

const monthPage = (year, month, history = []) => {
  const today = new Date(year, month, 15, 12);
  return pagesFor(history, 'month', today)[0];
};

test('month buckets are days 1–7, 8–14, 15–21, 22–28 plus wk 5 only when the month has a 29th', () => {
  const nov = monthPage(2026, 10);
  assert.deepEqual(nov.labels, ['wk 1', 'wk 2', 'wk 3', 'wk 4', 'wk 5']);
  assert.deepEqual(nov.pointDates, ['1–7 nov 2026', '8–14 nov 2026', '15–21 nov 2026', '22–28 nov 2026', '29–30 nov 2026']);
  assert.equal(monthPage(2026, 0).pointDates[4], '29–31 jan 2026');
  const feb = monthPage(2026, 1);
  assert.deepEqual(feb.labels, ['wk 1', 'wk 2', 'wk 3', 'wk 4'], 'no wk 5 in a 28-day February');
  const leapFeb = monthPage(2028, 1);
  assert.equal(leapFeb.labels.length, 5);
  assert.equal(leapFeb.pointDates[4], '29 feb 2028', 'single-day bucket shows one date');
});

test('each day lands in exactly one month bucket and every array lines up', () => {
  const history = [1, 7, 8, 21, 22, 28, 29, 30].map((d) => row(`2026-11-${String(d).padStart(2, '0')}`, d));
  const page = monthPage(2026, 10, history);
  assert.deepEqual(page.sessionMins, [1 + 7, 8, 21, 22 + 28, 29 + 30]);
  for (const key of ['scores', 'sessionMins', 'hasData', 'pointDates']) assert.equal(page[key].length, page.labels.length, key);
  assert.equal(page.startDate, '1 nov');
  assert.equal(page.endDate, '30 nov');
});

test('month page score is the time-weighted period score, not an average of bars', () => {
  const history = [row('2026-11-02', 60), row('2026-11-30', 0, 60)];
  const page = monthPage(2026, 10, history);
  // (100×60 + 25×60 + 50×10) / 130 = 61.5
  assert.equal(page.periodScore, Math.round((100 * 60 + 25 * 60 + 50 * 10) / 130));
});

// ── year ────────────────────────────────────────────────────────────────────

test('year page has jan–dec, each holding only its own month', () => {
  const [page] = pagesFor([row('2026-01-31', 10), row('2026-02-01', 20), row('2026-12-31', 30)], 'year');
  assert.deepEqual(page.labels, ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']);
  assert.equal(page.sessionMins[0], 10);
  assert.equal(page.sessionMins[1], 20);
  assert.equal(page.sessionMins[11], 30);
  assert.equal(page.hasData.filter(Boolean).length, 3);
});

// ── page counts ─────────────────────────────────────────────────────────────

test('history going back further adds pages (one per week / month / year)', () => {
  const history = [row('2025-10-01', 5), row('2026-11-13', 5)];
  assert.equal(pagesFor(history, 'year').length, 2);
  assert.equal(pagesFor(history, 'month').length, 14);
  assert.ok(pagesFor(history, 'week').length >= 58);
  assert.equal(pagesFor([], 'month').length >= 1, true, 'no history still renders a page');
});

test('a day with no row shows no data rather than a zero score', () => {
  const [page] = pagesFor([], 'week');
  assert.ok(page.hasData.every((h) => h === false));
  assert.equal(page.periodScore, null);
});
