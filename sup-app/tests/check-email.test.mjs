import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { checkEmailRegistered, EMAIL_CHECK_UNAVAILABLE } from '../src/lib/checkEmail.ts';
import { normalizeSupabaseUrl } from '../src/lib/supabaseUrl.ts';

for (const exists of [true, false]) test(`accepts boolean ${exists}`, async () => {
  const result = await checkEmailRegistered(' Test@Example.com ', async (name, options) => {
    assert.equal(name, 'check-email');
    assert.deepEqual(options, {body: {email: 'test@example.com'}});
    return {data: {exists}, error: null};
  });
  assert.deepEqual(result, {success: true, exists});
});

test('rejects malformed successes, HTTP failures and transport exceptions', async () => {
  const warn = console.warn; const logs = []; console.warn = (...args) => logs.push(args);
  try {
    for (const data of [undefined, null, {}, [], 'false', {exists: 'false'}, {exists: 0}, {exists: null}]) {
      assert.deepEqual(await checkEmailRegistered('test@example.com', async () => ({data, error: null})),
        {success: false, error: EMAIL_CHECK_UNAVAILABLE});
    }
    for (const status of [401, 403, 404, 429, 500, 503]) {
      assert.deepEqual(await checkEmailRegistered('test@example.com', async () => ({
        data: {exists: false}, error: {name: 'FunctionsHttpError', context: {status}, message: 'SECRET'}
      })), {success: false, error: EMAIL_CHECK_UNAVAILABLE});
    }
    for (const name of ['FunctionsFetchError', 'FunctionsRelayError', 'TypeError']) {
      assert.equal((await checkEmailRegistered('test@example.com', async () => {
        throw Object.assign(new Error('SECRET'), {name});
      })).success, false);
    }
    assert.ok(!JSON.stringify(logs).includes('SECRET'));
    assert.ok(!JSON.stringify(logs).includes('test@example.com'));
    for (const category of ['not_found', 'authorization', 'backend', 'transport', 'relay']) {
      assert.ok(logs.some(([, detail]) => detail.category === category));
    }
  } finally {console.warn = warn;}
});

test('REST endpoint config becomes the correct project root', () => {
  for (const suffix of ['', '/', '/rest/v1', '/rest/v1/']) {
    assert.equal(normalizeSupabaseUrl(` https://project.supabase.co${suffix} `), 'https://project.supabase.co');
  }
  assert.equal(normalizeSupabaseUrl(''), '');
});

// Execute the actual screen callback with mocked dependencies: no React Native
// runtime, production users, or real signup/email side effects are needed.
const source = ts.createSourceFile('details.tsx', readFileSync(new URL('../app/onboarding/details.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleNext') callback = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback);
const callbackJs = ts.transpile(`const handleNext = ${callback};`, {target: ts.ScriptTarget.ES2022});

test('signup screen blocks existing/failed checks and routes a new email to verification', async () => {
  for (const result of [{success: true, exists: true}, {success: false, error: EMAIL_CHECK_UNAVAILABLE}, {success: true, exists: false}]) {
    const calls = []; let message;
    const deps = {
      firstName: ' Test ', lastName: ' User ', username: ' tester ', password: 'agreed-test-password',
      confirmPassword: 'agreed-test-password', emailValid: true, normalizedEmail: 'test@example.com',
      setError: value => {message = value;}, isUsernameTaken: async () => false,
      checkEmailRegistered: async () => result,
      register: async (...args) => {calls.push(['register', ...args]); return {success: true};},
      setPendingSignup: value => calls.push(['pending', value]), router: {push: route => calls.push(['route', route])},
    };
    await new Function(...Object.keys(deps), `${callbackJs}; return handleNext();`)(...Object.values(deps));
    if (!result.success) {assert.equal(message, EMAIL_CHECK_UNAVAILABLE); assert.deepEqual(calls, []);}
    else if (result.exists) {assert.equal(message, 'this email is already registered, try signing in instead'); assert.deepEqual(calls, []);}
    else {
      assert.equal(calls[0][0], 'register'); assert.equal(calls[0][1], 'test@example.com');
      assert.equal(calls[1][0], 'pending'); assert.equal(calls[1][1].email, 'test@example.com');
      assert.deepEqual(calls[2], ['route', '/onboarding/verify-email']);
    }
  }
});

test('signed-out Supabase SDK reaches the handler and returns both existence outcomes', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const { createHandler } = await import('../supabase/functions/check-email/handler.ts');
  const handler = createHandler(() => async ({page}) => ({
    data: {users: page === 1 ? [{id: 'fixture', email: 'existing@example.com'}] : []}, error: null,
  }));
  const client = createClient(normalizeSupabaseUrl('https://project.supabase.co/rest/v1/'), 'fixture-anon-key', {
    auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
    global: {fetch: async (input, init) => {
      const req = new Request(input, init);
      assert.equal(req.url, 'https://project.supabase.co/functions/v1/check-email');
      assert.equal(req.headers.get('apikey'), 'fixture-anon-key');
      assert.equal(req.headers.get('authorization'), 'Bearer fixture-anon-key');
      return handler(req);
    }},
  });
  assert.equal((await client.auth.getSession()).data.session, null);
  for (const [email, exists] of [['existing@example.com', true], ['unused@example.com', false]]) {
    assert.deepEqual(await checkEmailRegistered(email, (name, options) => client.functions.invoke(name, options)),
      {success: true, exists});
  }
});
