import assert from "node:assert/strict";
import { createHandler } from "./handler.ts";

const request = (body: unknown) =>
  new Request("https://example.test/check-email", {
    method: "POST",
    body: JSON.stringify(body),
  });
const user = (email: string) => ({
  id: email,
  email,
  email_confirmed_at: "2026-10-18T00:00:00Z",
});

Deno.test("finds normalized existing email beyond page ten, including short pages", async () => {
  const pages: number[] = [];
  const handler = createHandler(() => async ({ page, perPage }) => {
    pages.push(page);
    assert.equal(perPage, 1000);
    return {
      data: {
        users: [user(page === 12 ? "Test@Example.com" : "other@example.com")],
      },
      error: null,
    };
  });
  const res = await handler(request({ email: " TEST@example.com " }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { exists: true });
  assert.equal(pages.length, 12);
});

Deno.test("matching unverified accounts can retry signup", async () => {
  for (const confirmedAt of [null, undefined]) {
    const pages: number[] = [];
    const handler = createHandler(() => async ({ page }) => {
      pages.push(page);
      return {
        data: {
          users: page === 1
            ? [user("other@example.com")]
            : [{ ...user("Test@Example.com"), email_confirmed_at: confirmedAt }],
        },
        error: null,
      };
    });
    const res = await handler(request({ email: " TEST@example.com " }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { exists: false });
    assert.deepEqual(pages, [1, 2]);
  }
});

Deno.test("only confirms unused email after reaching an empty page", async () => {
  const pages: number[] = [];
  const handler = createHandler(() => async ({ page }) => {
    pages.push(page);
    return {
      data: {
        users: page < 3
          ? [user("other@example.com"), { id: "phone-only" }]
          : [],
      },
      error: null,
    };
  });
  const res = await handler(request({ email: "unused@example.com" }));
  assert.deepEqual(await res.json(), { exists: false });
  assert.deepEqual(pages, [1, 2, 3]);
});

Deno.test("invalid email and malformed JSON return 400 without lookup", async () => {
  const handler = createHandler(() => {
    throw new Error("Must not lookup");
  });
  for (
    const body of [
      {},
      null,
      [],
      { email: null },
      { email: 42 },
      { email: "" },
      { email: " " },
      { email: "invalid" },
      { email: "a".repeat(255) + "@example.com" },
    ]
  ) {
    const res = await handler(request(body));
    assert.equal(res.status, 400);
    await res.body?.cancel();
  }
  const res = await handler(
    new Request("https://example.test", { method: "POST", body: "{" }),
  );
  assert.equal(res.status, 400);
  await res.body?.cancel();
});

Deno.test("CORS preflight and unsupported methods", async () => {
  const handler = createHandler(() => {
    throw new Error("Must not lookup");
  });
  for (
    const [method, status] of [["OPTIONS", 204], ["GET", 405], [
      "PUT",
      405,
    ]] as const
  ) {
    const res = await handler(new Request("https://example.test", { method }));
    assert.equal(res.status, status);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    if (status === 405) assert.equal(res.headers.get("Allow"), "POST, OPTIONS");
    await res.body?.cancel();
  }
});

Deno.test("upstream errors, malformed data, missing config and lookup limit fail closed with redacted logs", async () => {
  const logs: unknown[] = [];
  const original = console.error;
  console.error = (...args) => logs.push(args);
  try {
    const cases = [
      ...[401, 403, 429, 500, 503].map((status) => () => async () => ({
        data: { users: [] },
        error: { status, message: "SECRET" },
      })),
      () => async () => {
        throw new TypeError("SECRET");
      },
      () => {
        throw new Error("SECRET");
      },
      ...[null, {}, { users: null }, { users: [null] }, {
        users: [{ id: "x", email: 42 }],
      }].map((data) => () => async () => ({ data, error: null })),
      () => async () => ({
        data: { users: [user("other@example.com")] },
        error: null,
      }),
      () => async ({ page }: { page: number }) =>
        page === 1
          ? { data: { users: [user("other@example.com")] }, error: null }
          : { data: { users: [] }, error: { status: 503 } },
    ];
    for (const lookup of cases) {
      const res = await createHandler(lookup)(
        request({ email: "unused@example.com" }),
      );
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), {
        error: "Email check unavailable. Please try again.",
      });
    }
    assert.ok(!JSON.stringify(logs).includes("SECRET"));
    assert.ok(!JSON.stringify(logs).includes("@example.com"));
  } finally {
    console.error = original;
  }
});
