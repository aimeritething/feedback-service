import assert from "node:assert/strict";
import test from "node:test";
import type { Db, StoredFeedback } from "../src/db.js";
import type { FeishuClient } from "../src/feishu.js";
import { createFeishuPublisher, ensureBitableFields } from "../src/publish.js";
import { BITABLE_FIELDS } from "../src/projection.js";
import type { Storage } from "../src/storage.js";
import type { DiagnosticLogs, Screenshot } from "../src/validate.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const shot: Screenshot = { kind: "png", bytes: PNG };
const logs: DiagnosticLogs = { kind: "zip", bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) };

const record = (id = "fb_1"): StoredFeedback => ({
  id,
  payload: {
    kind: "issue",
    description: "broken",
    locale: "en-US",
    environment: { appVersion: "1", osPlatform: "darwin", osRelease: "25", osArch: "arm64", productEdition: null, region: "https://hzh.sealos.run" },
  },
  user: { uid: "u", id: "jamie", name: null },
  screenshotKeys: ["screenshots/fb_1/1.png"],
  logsKey: null,
  createdAt: new Date(0),
});

function harness(options: { createRecordFails?: boolean; chatId?: string } = {}) {
  const calls: string[] = [];
  const synced: [string, string][] = [];
  const failed: [string, string][] = [];
  const cards: { chatId: string; content: unknown }[] = [];
  const recordFields: Record<string, unknown>[] = [];
  let unsynced: StoredFeedback[] = [];
  const feishu: FeishuClient = {
    uploadImage: async () => (calls.push("uploadImage"), "img_1"),
    uploadAttachment: async (name) => (calls.push(`uploadAttachment:${name}`), "file_1"),
    createRecord: async (fields) => {
      calls.push("createRecord");
      recordFields.push(fields);
      if (options.createRecordFails) throw new Error("bitable down");
      assert.equal(fields[BITABLE_FIELDS.id], "fb_1");
      return "rec_1";
    },
    listFieldNames: async () => Object.values(BITABLE_FIELDS),
    sendCard: async (chatId, content) => (cards.push({ chatId, content }), "om_1"),
  };
  const db: Db = {
    insert: async () => {
      throw new Error("unused");
    },
    countRecent: async () => 0,
    listUnsynced: async () => unsynced,
    markSynced: async (id, rec) => void synced.push([id, rec]),
    markSyncFailed: async (id, err) => void failed.push([id, err]),
    close: async () => {},
  };
  const storage: Storage = {
    put: async () => {},
    get: async (key) => (calls.push(`storage.get:${key}`), key.endsWith(".zip") ? logs : shot),
  };
  const publisher = createFeishuPublisher({
    feishu,
    db,
    storage,
    chatId: options.chatId ?? "oc_1",
    cardTemplate: { url: "{{record_url}}", imgs: "{{images}}", logs: "{{logs}}" },
    bitableUrl: "https://acme.feishu.cn/base/app",
    tableId: "tbl",
    timeZone: "UTC",
    log: { warn: () => {}, info: () => {} },
  });
  return { publisher, calls, synced, failed, cards, recordFields, setUnsynced: (rows: StoredFeedback[]) => (unsynced = rows) };
}

test("publish: attachments → record → marks synced → card links to the record", async () => {
  const h = harness();
  await h.publisher.publish(record(), [shot], null);
  assert.deepEqual(h.calls, ["uploadAttachment:fb_1-1.png", "createRecord", "uploadImage"]);
  assert.deepEqual(h.synced, [["fb_1", "rec_1"]]);
  assert.deepEqual(h.failed, []);
  assert.deepEqual(h.cards, [
    { chatId: "oc_1", content: { url: "https://acme.feishu.cn/base/app?table=tbl&record=rec_1", imgs: [{ img_key: "img_1" }], logs: "—" } },
  ]);
});

test("publish: bitable failure is recorded, card still goes out pointing at the table", async () => {
  const h = harness({ createRecordFails: true });
  await h.publisher.publish(record(), []);
  assert.deepEqual(h.synced, []);
  assert.deepEqual(h.failed, [["fb_1", "bitable down"]]);
  assert.equal((h.cards[0]?.content as { url: string }).url, "https://acme.feishu.cn/base/app");
});

test("publish: no chat id → table only, no card", async () => {
  const h = harness({ chatId: "" });
  await h.publisher.publish(record(), []);
  assert.deepEqual(h.cards, []);
  assert.equal(h.synced.length, 1);
});

test("syncPending re-reads screenshots from storage and syncs without sending cards", async () => {
  const h = harness();
  h.setUnsynced([record()]);
  assert.equal(await h.publisher.syncPending(), 1);
  assert.deepEqual(h.calls, ["storage.get:screenshots/fb_1/1.png", "uploadAttachment:fb_1-1.png", "createRecord"]);
  assert.deepEqual(h.cards, []);
});

test("ensureBitableFields names every missing column", async () => {
  const feishu = { listFieldNames: async () => ["编号", "描述"] } as unknown as FeishuClient;
  await assert.rejects(ensureBitableFields(feishu), /missing fields: 类型, 截图/);
});

test("publish with diagnostic logs: zip goes to the 日志 attachment column, card says 附日志", async () => {
  const h = harness();
  // 卡片和表格看的是记录上的 logsKey（app 落库时写入），不是 publish 参数本身。
  await h.publisher.publish({ ...record(), logsKey: "logs/fb_1/diagnostic-logs.zip" }, [shot], logs);
  assert.deepEqual(h.calls, [
    "uploadAttachment:fb_1-1.png",
    "uploadAttachment:fb_1-diagnostic-logs.zip",
    "createRecord",
    "uploadImage",
  ]);
  assert.deepEqual(h.recordFields[0]?.[BITABLE_FIELDS.logs], [{ file_token: "file_1" }]);
  assert.deepEqual(h.recordFields[0]?.[BITABLE_FIELDS.screenshots], [{ file_token: "file_1" }]);
  assert.equal(JSON.stringify(h.cards[0]?.content).includes("附日志"), true);
});

test("publish without logs: no 日志 column, card shows a dash", async () => {
  const h = harness();
  await h.publisher.publish(record(), [shot], null);
  assert.equal(BITABLE_FIELDS.logs in (h.recordFields[0] ?? {}), false);
  assert.equal(JSON.stringify(h.cards[0]?.content).includes("附日志"), false);
});

test("syncPending re-reads the logs zip from storage when the record has a logs key", async () => {
  const h = harness();
  h.setUnsynced([{ ...record("fb_1"), logsKey: "logs/fb_1/diagnostic-logs.zip" }]);
  assert.equal(await h.publisher.syncPending(), 1);
  assert.deepEqual(h.calls, [
    "storage.get:screenshots/fb_1/1.png",
    "storage.get:logs/fb_1/diagnostic-logs.zip",
    "uploadAttachment:fb_1-1.png",
    "uploadAttachment:fb_1-diagnostic-logs.zip",
    "createRecord",
  ]);
});
