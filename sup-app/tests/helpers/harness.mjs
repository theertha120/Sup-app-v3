// Shared test harness: loads the app's real TypeScript source under Node with
// every native/network dependency replaced by an explicit fake. No new npm
// dependencies — only `typescript` (already a devDependency) and node:test.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.React, esModuleInterop: true,
};
const GLOBAL_NAMES = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'console', 'Math'];

export const read = (rel) => {
  const raw = readFileSync(join(ROOT, rel), 'utf8');
  return globalThis.__sourceTransform ? globalThis.__sourceTransform(join(ROOT, rel), raw) : raw;
};

function resolveFile(base) {
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (statSync(base + ext, { throwIfNoEntry: false })?.isFile()) return base + ext;
  }
  return null;
}

/**
 * Loads `rel` (a repo-relative .ts/.tsx path) as CommonJS. Imports resolve to:
 *   1. `mocks[specifier]` if given (exact specifier as written in the source),
 *   2. otherwise app source (relative or "@/..." paths), loaded recursively,
 *   3. anything else throws, so a new native/network import fails loudly
 *      instead of silently hitting a real service.
 * `globals` overrides timers/Date/console/Math for every loaded module, and
 * can add others (e.g. fetch, Deno, __DEV__).
 * `globalThis.__sourceTransform(file, src)`, if set, rewrites source in memory
 * before transpiling — for mutation-checking tests without touching files.
 */
export function loadTs(rel, { mocks = {}, globals = {} } = {}) {
  const cache = new Map();
  // Files using JSX without importing React (automatic runtime) still compile
  // to React.createElement here, so expose the mocked React as a global.
  const g = { setTimeout, clearTimeout, setInterval, clearInterval, Date, console, Math, ...(mocks.react && { React: mocks.react }), ...globals };
  const names = [...new Set([...GLOBAL_NAMES, ...(mocks.react ? ['React'] : []), ...Object.keys(globals)])];

  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const raw = readFileSync(file, 'utf8');
    const src = globalThis.__sourceTransform ? globalThis.__sourceTransform(file, raw) : raw;
    const js = ts.transpile(src, COMPILER_OPTIONS, file);
    const require = (spec) => {
      if (spec in mocks) return mocks[spec];
      let target = null;
      if (spec.startsWith('@/')) target = resolveFile(join(ROOT, spec.slice(2)));
      else if (spec.startsWith('.')) target = resolveFile(resolve(dirname(file), spec));
      assert.ok(target, `Unmocked import "${spec}" from ${file.slice(ROOT.length + 1)}`);
      return load(target);
    };
    new Function('require', 'module', 'exports', ...names, js)(
      require, module, module.exports, ...names.map((n) => g[n]),
    );
    return module.exports;
  }
  return load(resolveFile(join(ROOT, rel)));
}

/**
 * Pulls named top-level declarations (functions/consts/types are fine) out of a
 * file that can't be imported whole — e.g. a screen whose pure helpers live
 * next to React Native UI. `scope` supplies whatever those helpers reference.
 */
export function extractDeclarations(rel, names, scope = {}) {
  const source = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const wanted = new Set(names);
  const chunks = [];
  for (const stmt of source.statements) {
    const declared = ts.isFunctionDeclaration(stmt) ? [stmt.name?.text]
      : ts.isVariableStatement(stmt) ? stmt.declarationList.declarations.map((d) => d.name.getText(source))
      : [];
    if (declared.some((n) => wanted.has(n))) {
      chunks.push(stmt.getText(source).replace(/^export\s+/, ''));
      declared.forEach((n) => wanted.delete(n));
    }
  }
  assert.equal(wanted.size, 0, `Not found in ${rel}: ${[...wanted].join(', ')}`);
  const js = ts.transpile(`${chunks.join('\n')}\nreturn { ${names.join(', ')} };`, COMPILER_OPTIONS);
  return new Function(...Object.keys(scope), js)(...Object.values(scope));
}

/**
 * Pulls `const name = ...` declarations from anywhere in a file — e.g. event
 * handlers inside a screen component — and runs them with `scope` standing in
 * for the component's state, hooks and imports.
 */
export function extractHandlers(rel, names, scope = {}) {
  const source = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = {};
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(source)) && !found[node.name.getText(source)]) {
      found[node.name.getText(source)] = node.initializer.getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const missing = names.filter((n) => !found[n]);
  assert.equal(missing.length, 0, `Not found in ${rel}: ${missing.join(', ')}`);
  const js = ts.transpile(
    `${names.map((n) => `const ${n} = ${found[n]};`).join('\n')}\nreturn { ${names.join(', ')} };`,
    { target: ts.ScriptTarget.ES2022 },
  );
  return new Function(...Object.keys(scope), js)(...Object.values(scope));
}

/** A controllable clock + timer queue shared by Date, setTimeout and setInterval. */
export function fakeClock(startMs = new Date(2026, 10, 13, 10, 0, 0).getTime()) {
  let now = startMs;
  let nextId = 1;
  const timers = new Map();
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const add = (fn, ms, repeat) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + Math.max(0, ms ?? 0), every: repeat ? Math.max(1, ms ?? 0) : null });
    return id;
  };
  const clock = {
    Date: FakeDate,
    setTimeout: (fn, ms) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
    now: () => now,
    timers,
    /** Advance time, firing due timers in order (intervals repeat). */
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        const [id, t] = next;
        now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        t.fn();
      }
      now = end;
    },
    set(ms) { now = ms; },
  };
  return clock;
}

/** Lets pending promise callbacks run. */
export const flush = async (rounds = 5) => { for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r)); };

export const quietConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };

/** Records captureError/breadcrumb calls in place of src/lib/sentry. */
export function fakeSentry() {
  const errors = [];
  const breadcrumbs = [];
  return {
    errors, breadcrumbs,
    module: {
      captureError: (error, context, extra) => errors.push({ error, context, extra }),
      createThrottledErrorReporter: () => (error, context, extra) => errors.push({ error, context, extra, throttled: true }),
      sentryBreadcrumb: (message, data) => breadcrumbs.push({ message, data }),
      captureFunctionError: async () => {},
      setSentryUser() {}, setSentryScreen() {}, initSentry() {},
    },
  };
}

/** In-memory AsyncStorage. */
export function fakeAsyncStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  const api = {
    store,
    getItem: async (k) => (store.has(k) ? store.get(k) : null),
    setItem: async (k, v) => { store.set(k, v); },
    removeItem: async (k) => { store.delete(k); },
  };
  return { ...api, default: api };
}

/**
 * Chainable Supabase stand-in. Every `.from(table)` chain is recorded as
 * { table, ops: [[method, ...args], ...] } and resolved by `respond(query)`,
 * which returns { data, error } (default: { data: null, error: null }).
 */
export function fakeSupabase(respond = () => ({ data: null, error: null }), { user = { id: 'user-1' } } = {}) {
  const queries = [];
  const builder = (query) => {
    const proxy = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          return (ok, fail) => Promise.resolve().then(() => respond(query) ?? { data: null, error: null }).then(ok, fail);
        }
        return (...args) => { query.ops.push([prop, ...args]); return proxy; };
      },
    });
    return proxy;
  };
  const client = {
    from(table) { const q = { table, ops: [] }; queries.push(q); return builder(q); },
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
  };
  return { client, queries, module: { supabase: client } };
}

/** Value passed to the first op named `method` in a recorded query. */
export const opArg = (query, method) => query.ops.find(([m]) => m === method)?.[1];
/** Map of column → value from every .eq() in a recorded query. */
export const eqs = (query) => Object.fromEntries(query.ops.filter(([m]) => m === 'eq').map(([, c, v]) => [c, v]));

/**
 * Just enough React to run hooks-based providers outside React Native.
 * Components are plain functions; `render()` re-runs them and flushes effects.
 */
export function miniReact() {
  let active = null;
  const react = {
    createContext: (value) => ({ Provider: 'Provider', _default: value }),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useContext: (ctx) => ctx._current ?? ctx._default,
    useRef: (initial) => {
      const i = active.cursor++;
      return (active.slots[i] ??= { current: initial });
    },
    useState: (initial) => {
      const owner = active;
      const i = owner.cursor++;
      if (!(i in owner.slots)) owner.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [owner.slots[i], (next) => {
        owner.slots[i] = typeof next === 'function' ? next(owner.slots[i]) : next;
      }];
    },
    useEffect: (effect, deps) => {
      const owner = active;
      const i = owner.cursor++;
      const prev = owner.slots[i];
      if (!prev || !deps || deps.some((d, k) => d !== prev.deps[k])) {
        owner.effects.push(() => {
          prev?.cleanup?.();
          owner.slots[i] = { deps, cleanup: effect() };
        });
      }
    },
    useMemo: (fn, deps) => {
      const i = active.cursor++;
      const prev = active.slots[i];
      if (prev && deps && deps.every((d, k) => d === prev.deps[k])) return prev.value;
      const value = fn();
      active.slots[i] = { deps, value };
      return value;
    },
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
  };
  react.default = react;
  react.Fragment = 'Fragment';
  const mount = (component) => {
    const owner = { cursor: 0, slots: [], effects: [] };
    return {
      render() {
        active = owner;
        owner.cursor = 0;
        const out = component();
        active = null;
        owner.effects.splice(0).forEach((e) => e());
        return out;
      },
      unmount() { owner.slots.forEach((s) => s?.cleanup?.()); },
    };
  };
  return { react, mount };
}

/** A 20-byte WT9011DCL notification packet (flag 0x61) for the given angles. */
export function imuPacket({ roll = 0, pitch = 0, yaw = 0, ax = 0, ay = 0, az = 1, gx = 0, gy = 0, gz = 0 } = {}) {
  const bytes = new Uint8Array(20);
  bytes[0] = 0x55; bytes[1] = 0x61;
  const put = (offset, value, scale) => {
    const raw = Math.round((value / scale) * 32768);
    const v = raw < 0 ? raw + 65536 : raw;
    bytes[offset] = v & 0xff; bytes[offset + 1] = (v >> 8) & 0xff;
  };
  put(2, ax, 16); put(4, ay, 16); put(6, az, 16);
  put(8, gx, 2000); put(10, gy, 2000); put(12, gz, 2000);
  put(14, roll, 180); put(16, pitch, 180); put(18, yaw, 180);
  return new DataView(bytes.buffer);
}
