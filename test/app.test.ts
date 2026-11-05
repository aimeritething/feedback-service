import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AuthError, resolveRegion } from "../src/auth.js";
import type { Db, FeedbackRecord, StoredFeedback } from "../src/db.js";
import type { Storage } from "../src/storage.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const ALLOWED = ["hzh.sealos.run"];

function harness(options: { authStatus?: number; recent?: number } = {}) {
  const inserted: FeedbackRecord[] = [];
  const stored: string[] = [];
  const published: { record: StoredFeedback; screenshots: number; logs: number | null }[] = [];
  const authCalls: { url: string; token: string | null }[] = [];
  const db: Db = {
    insert: async (record) => {
      inserted.push(record);
      return { ...record, createdAt: new Date("2026-11-05T04:12:00Z") };
    },
    countRecent: async () => options.recent ?? 0,
    listUnsynced: async () => [],
    markSynced: async () => {},
    markSyncFailed: async () => {},
    close: async () => {},
  };
  const storage: Storage = {
    put: async (key) => {
      stored.push(key);
    },
    get: async () => {
      throw new Error("not used");
    },
  };
  const app = createApp({
    fetch: async (input, init) => {
      authCalls.push({ url: String(input), token: new Headers(init?.headers).get("Authorization") });
      const status = options.authStatus ?? 200;
      if (status !== 200) return new Response(null, { status });
      return Response.json({ code: 200, data: { info: { uid: "u-1", id: "jamie", nickname: "Jamie" } } });
    },
    db,
    storage,
    publisher: {
      publish: async (record, screenshots, logs) =>
        void published.push({ record, screenshots: screenshots.length, logs: logs ? logs.bytes.byteLength : null }),
    },
    allowedRegions: ALLOWED,
    rateLimitPerHour: 3,
  });
  return { app, inserted, stored, published, authCalls };
}

function form(kind: "issue" | "feature", files: File[] = [], logs?: File): FormData {
  const fd = new FormData();
  fd.append(
    "payload",
    JSON.stringify({
      kind,
      description: "Deploy button does nothing",
      ...(kind === "feature" ? { expectedSolution: "A prompt menu", contact: "me@example.com" } : {}),
      locale: "zh-CN",
      ...(kind === "issue" ? { context: { workspaceId: "ns-acme", sessionId: "task-1" } } : {}),
      environment: {
        appVersion: "0.10.3",
        osPlatform: "darwin",
        osRelease: "25.4.0",
        osArch: "arm64",
        productEdition: "china",
        region: "https://hzh.sealos.run",
      },
    }),
  );
  for (const file of files) fd.append("screenshots", file, file.name);
  if (logs) fd.append("logs", logs, logs.name);
  return fd;
}

const post = (app: ReturnType<typeof createApp>, body: FormData, headers: Record<string, string>) =>
  app.request("/v1/feedback", { method: "POST", body, headers });

const okHeaders = { Authorization: "tok", "X-Sealos-Region": "https://hzh.sealos.run" };

test("accepts an issue with a screenshot: verifies token, stores, inserts, notifies", async () => {
  const h = harness();
  const resp = await post(h.app, form("issue", [new File([PNG], "shot.png", { type: "image/png" })]), okHeaders);
  assert.equal(resp.status, 201);
  const body = (await resp.json()) as { id: string };
  assert.match(body.id, /^fb_[0-9a-f]{20}$/);
  assert.deepEqual(h.authCalls, [{ url: "https://hzh.sealos.run/api/auth/info", token: "tok" }]);
  assert.deepEqual(h.stored, [`screenshots/${body.id}/1.png`]);
  assert.equal(h.inserted.length, 1);
  assert.equal(h.inserted[0]?.user.uid, "u-1");
  assert.deepEqual(h.inserted[0]?.screenshotKeys, [`screenshots/${body.id}/1.png`]);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0]?.record.id, body.id);
  assert.equal(h.published[0]?.record.createdAt.toISOString(), "2026-11-05T04:12:00.000Z");
  assert.equal(h.published[0]?.screenshots, 1);
  assert.equal(h.published[0]?.logs, null);
  assert.equal(h.inserted[0]?.logsKey, null);
});

test("issue with diagnostic logs: zip stored under logs/, key recorded, handed to the publisher", async () => {
  const h = harness();
  const resp = await post(
    h.app,
    form("issue", [], new File([ZIP], "diagnostic-logs.zip", { type: "application/zip" })),
    okHeaders,
  );
  assert.equal(resp.status, 201);
  const { id } = (await resp.json()) as { id: string };
  assert.deepEqual(h.stored, [`logs/${id}/diagnostic-logs.zip`]);
  assert.equal(h.inserted[0]?.logsKey, `logs/${id}/diagnostic-logs.zip`);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.published[0]?.logs, ZIP.byteLength);
});

test("diagnostic logs: over 20 MB → 413, not a zip → 415, nothing stored", async () => {
  const big = harness();
  const oversized = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "diagnostic-logs.zip");
  assert.equal((await post(big.app, form("issue", [], oversized), okHeaders)).status, 413);
  assert.deepEqual(big.stored, []);
  const notZip = harness();
  const text = new File([new TextEncoder().encode("hello")], "diagnostic-logs.zip", { type: "application/zip" });
  assert.equal((await post(notZip.app, form("issue", [], text), okHeaders)).status, 415);
  assert.deepEqual(notZip.stored, []);
  assert.equal(notZip.inserted.length, 0);
});

test("feature request ignores a logs field: accepted, nothing stored", async () => {
  const h = harness();
  const resp = await post(h.app, form("feature", [], new File([ZIP], "diagnostic-logs.zip")), okHeaders);
  assert.equal(resp.status, 201);
  assert.deepEqual(h.stored, []);
  assert.equal(h.inserted[0]?.logsKey, null);
});

test("accepts a feature request without screenshots", async () => {
  const h = harness();
  const resp = await post(h.app, form("feature"), okHeaders);
  assert.equal(resp.status, 201);
  assert.equal("expectedSolution" in (h.inserted[0]?.payload ?? {}), false, "legacy fields are dropped");
  assert.deepEqual(h.stored, []);
});

test("accepts a feature request with screenshots", async () => {
  const h = harness();
  const resp = await post(h.app, form("feature", [new File([PNG], "sketch.png")]), okHeaders);
  assert.equal(resp.status, 201);
  assert.equal(h.inserted[0]?.payload.kind, "feature");
  assert.equal(h.stored.length, 1);
});

test("rejects before parsing the body when region or token is bad", async () => {
  const h = harness();
  assert.equal((await post(h.app, form("issue"), { Authorization: "tok" })).status, 400);
  assert.equal(
    (await post(h.app, form("issue"), { Authorization: "tok", "X-Sealos-Region": "https://evil.example" })).status,
    400,
  );
  assert.equal((await post(h.app, form("issue"), { "X-Sealos-Region": "https://hzh.sealos.run" })).status, 401);
  assert.equal(h.authCalls.length, 0, "token never sent to a non-allowlisted region");
  const rejected = harness({ authStatus: 401 });
  assert.equal((await post(rejected.app, form("issue"), okHeaders)).status, 401);
  assert.equal(rejected.inserted.length, 0);
});

test("rate limits per user and maps validation failures to status codes", async () => {
  const limited = harness({ recent: 3 });
  assert.equal((await post(limited.app, form("issue"), okHeaders)).status, 429);
  const h = harness();
  const fake = new File([new TextEncoder().encode("hello")], "shot.png", { type: "image/png" });
  assert.equal((await post(h.app, form("issue", [fake]), okHeaders)).status, 415);
  assert.equal(h.inserted.length, 0);
});

test("resolveRegion only accepts https origins on the allowlist", () => {
  assert.equal(resolveRegion("https://HZH.sealos.run/", ALLOWED), "https://hzh.sealos.run");
  for (const bad of [undefined, "not a url", "http://hzh.sealos.run", "https://bja.sealos.run"]) {
    assert.throws(() => resolveRegion(bad, ALLOWED), (e: unknown) => e instanceof AuthError && e.status === 400);
  }
});
