import { buildCardContent } from "./card.js";
import type { Db, StoredFeedback } from "./db.js";
import type { FeishuClient } from "./feishu.js";
import { BITABLE_FIELDS, projectFeedback, toBitableFields, toCardVariables } from "./projection.js";
import type { Storage } from "./storage.js";
import type { Screenshot } from "./validate.js";

export interface Publisher {
  publish(record: StoredFeedback, screenshots: readonly Screenshot[]): Promise<void>;
}

export interface FeishuPublisherOptions {
  feishu: FeishuClient;
  db: Db;
  storage: Storage;
  chatId?: string | undefined;
  cardTemplateId?: string | undefined;
  cardTemplate?: unknown;
  bitableUrl: string;
  tableId: string;
  timeZone: string;
  log?: Pick<Console, "warn" | "info">;
}

export interface FeishuPublisher extends Publisher {
  syncPending(): Promise<number>;
}

export async function ensureBitableFields(feishu: FeishuClient): Promise<void> {
  const present = new Set(await feishu.listFieldNames());
  const missing = Object.values(BITABLE_FIELDS).filter((name) => !present.has(name));
  if (missing.length > 0) throw new Error(`bitable table is missing fields: ${missing.join(", ")}`);
}

export function createFeishuPublisher(opts: FeishuPublisherOptions): FeishuPublisher {
  const log = opts.log ?? console;
  const recordUrl = (recordId: string | null) =>
    recordId ? `${opts.bitableUrl}?table=${opts.tableId}&record=${recordId}` : opts.bitableUrl;

  async function syncToBitable(record: StoredFeedback, screenshots: readonly Screenshot[]): Promise<string | null> {
    try {
      const tokens: string[] = [];
      for (const [i, shot] of screenshots.entries()) {
        tokens.push(await opts.feishu.uploadAttachment(`${record.id}-${i + 1}.${shot.kind === "jpeg" ? "jpg" : shot.kind}`, shot.bytes, shot.kind));
      }
      const view = projectFeedback(record, opts.timeZone);
      const recordId = await opts.feishu.createRecord(toBitableFields(view, tokens));
      await opts.db.markSynced(record.id, recordId);
      return recordId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`[bitable] ${record.id} not synced: ${message}`);
      await opts.db.markSyncFailed(record.id, message).catch(() => {});
      return null;
    }
  }

  async function sendCard(record: StoredFeedback, screenshots: readonly Screenshot[], recordId: string | null): Promise<void> {
    if (!opts.chatId) return;
    try {
      const keys: string[] = [];
      for (const shot of screenshots) keys.push(await opts.feishu.uploadImage(shot.bytes, shot.kind));
      const vars = toCardVariables(projectFeedback(record, opts.timeZone), keys, recordUrl(recordId));
      const content = buildCardContent({ templateId: opts.cardTemplateId, template: opts.cardTemplate }, vars);
      await opts.feishu.sendCard(opts.chatId, content);
    } catch (error) {
      log.warn(`[card] ${record.id} not sent: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    async publish(record, screenshots) {
      const recordId = await syncToBitable(record, screenshots);
      await sendCard(record, screenshots, recordId);
    },
    async syncPending() {
      const pending = await opts.db.listUnsynced(50);
      let synced = 0;
      for (const record of pending) {
        let screenshots: Screenshot[];
        try {
          screenshots = await Promise.all(record.screenshotKeys.map((key) => opts.storage.get(key)));
        } catch (error) {
          log.warn(`[bitable] ${record.id} screenshots unreadable: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        if (await syncToBitable(record, screenshots)) synced++;
      }
      if (pending.length > 0) log.info(`[bitable] resynced ${synced}/${pending.length}`);
      return synced;
    },
  };
}

export function startSyncLoop(publisher: FeishuPublisher, intervalMs: number): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await publisher.syncPending();
    } catch (error) {
      console.warn("[bitable] sync loop failed:", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
