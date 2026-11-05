import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadCardTemplate } from "./card.js";
import { bitableUrl, loadConfig } from "./config.js";
import { createPgDb } from "./db.js";
import { createFeishuClient } from "./feishu.js";
import { runMigrations } from "./migrate.js";
import { createFeishuPublisher, ensureBitableFields, startSyncLoop } from "./publish.js";
import { createS3Storage } from "./storage.js";

const config = loadConfig();
const root = join(import.meta.dirname, "..");
const applied = await runMigrations(config.DATABASE_URL, join(root, "migrations"));
console.log(`migrations applied: ${applied.join(", ") || "(none)"}`);

const feishu = createFeishuClient(fetch, {
  baseUrl: config.FEISHU_BASE_URL,
  appId: config.FEISHU_APP_ID,
  appSecret: config.FEISHU_APP_SECRET,
  appToken: config.BITABLE_APP_TOKEN,
  tableId: config.BITABLE_TABLE_ID,
});
await ensureBitableFields(feishu);
console.log(`bitable table ${config.BITABLE_TABLE_ID} ok`);

const db = createPgDb(config.DATABASE_URL);
const storage = createS3Storage(config);
const publisher = createFeishuPublisher({
  feishu,
  db,
  storage,
  chatId: config.FEISHU_CHAT_ID || undefined,
  cardTemplateId: config.FEISHU_CARD_TEMPLATE_ID || undefined,
  cardTemplate: await loadCardTemplate(join(root, "templates", "feedback-card.json")),
  bitableUrl: bitableUrl(config),
  tableId: config.BITABLE_TABLE_ID,
  timeZone: config.DISPLAY_TIMEZONE,
});
const stopSync = startSyncLoop(publisher, config.SYNC_INTERVAL_SECONDS * 1000);

const app = createApp({
  fetch,
  db,
  storage,
  publisher,
  allowedRegions: config.ALLOWED_REGIONS,
  rateLimitPerHour: config.RATE_LIMIT_PER_HOUR,
});

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`feedback-service listening on :${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopSync();
    server.close();
    void db.close().finally(() => process.exit(0));
  });
}
