import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { AuthError, resolveRegion, verifyToken } from "./auth.js";
import type { Db } from "./db.js";
import type { Publisher } from "./publish.js";
import type { Storage } from "./storage.js";
import { ValidationError, parseLogs, parsePayload, parseScreenshots } from "./validate.js";

export interface AppDeps {
  fetch: typeof fetch;
  db: Db;
  storage: Storage;
  publisher: Publisher;
  allowedRegions: readonly string[];
  rateLimitPerHour: number;
  now?: () => number;
}

export function createApp(deps: AppDeps) {
  const now = deps.now ?? (() => Date.now());
  const app = new Hono();

  app.get("/healthz", (c) => c.text("ok"));

  app.post("/v1/feedback", async (c) => {
    try {
      const region = resolveRegion(c.req.header("x-sealos-region"), deps.allowedRegions);
      const user = await verifyToken(deps.fetch, region, c.req.header("authorization"));

      const recent = await deps.db.countRecent(user.uid, now() - 3600_000);
      if (recent >= deps.rateLimitPerHour) return c.body(null, 429);

      const body = await c.req.parseBody({ all: true });
      const payload = parsePayload(body["payload"]);
      const rawFiles = body["screenshots"];
      const files = (Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : []).filter(
        (entry): entry is File => entry instanceof File,
      );
      const screenshots = await parseScreenshots(files);
      // Diagnostic logs 只跟 issue：feature 发来的 logs 字段直接忽略，不存也不报错。
      const rawLogs = body["logs"];
      const logs = payload.kind === "issue" ? await parseLogs(rawLogs instanceof File ? rawLogs : undefined) : null;

      const id = `fb_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
      const keys: string[] = [];
      for (const [index, shot] of screenshots.entries()) {
        const key = `screenshots/${id}/${index + 1}.${shot.kind === "jpeg" ? "jpg" : shot.kind}`;
        await deps.storage.put(key, shot.bytes, shot.kind);
        keys.push(key);
      }
      let logsKey: string | null = null;
      if (logs) {
        logsKey = `logs/${id}/diagnostic-logs.zip`;
        await deps.storage.put(logsKey, logs.bytes, logs.kind);
      }
      const record = await deps.db.insert({ id, payload, user, screenshotKeys: keys, logsKey });
      void deps.publisher.publish(record, screenshots, logs);
      return c.json({ id }, 201);
    } catch (error) {
      if (error instanceof AuthError || error instanceof ValidationError) {
        return c.json({ error: error.message }, error.status);
      }
      console.error("[feedback] unexpected failure:", error);
      return c.body(null, 500);
    }
  });

  return app;
}
