import assert from "node:assert/strict";
import test from "node:test";
import { bitableUrl, loadConfig } from "../src/config.js";

const base = {
  DATABASE_URL: "postgres://u:p@h:5432/d",
  S3_ENDPOINT: "objectstorageapi.bja.sealos.run",
  S3_BUCKET: "b",
  S3_ACCESS_KEY: "a",
  S3_SECRET_KEY: "s",
  ALLOWED_REGIONS: "hzh.sealos.run",
  FEISHU_APP_ID: "cli_x",
  FEISHU_APP_SECRET: "sec",
  BITABLE_APP_TOKEN: "basetoken",
  BITABLE_TABLE_ID: "tblx",
};

test("S3_ENDPOINT accepts a bare host (Sealos bucket secret) and adds the scheme", () => {
  assert.equal(loadConfig({ ...base, S3_ENDPOINT: "objectstorageapi.bja.sealos.run" }).S3_ENDPOINT, "https://objectstorageapi.bja.sealos.run");
  assert.equal(
    loadConfig({ ...base, S3_ENDPOINT: "object-storage.objectstorage-system.svc.cluster.local" }).S3_ENDPOINT,
    "http://object-storage.objectstorage-system.svc.cluster.local",
  );
  assert.equal(loadConfig({ ...base, S3_ENDPOINT: "http://minio:9000" }).S3_ENDPOINT, "http://minio:9000");
  assert.throws(() => loadConfig({ ...base, S3_ENDPOINT: "" }), /S3_ENDPOINT/);
});

test("feishu settings: app + table required, chat and template optional, sane defaults", () => {
  const config = loadConfig(base);
  assert.equal(config.FEISHU_BASE_URL, "https://open.feishu.cn");
  assert.equal(config.SYNC_INTERVAL_SECONDS, 300);
  assert.equal(config.DISPLAY_TIMEZONE, "Asia/Shanghai");
  assert.equal(config.FEISHU_CHAT_ID, undefined);
  assert.equal(bitableUrl(config), "https://feishu.cn/base/basetoken");
  assert.equal(
    bitableUrl(loadConfig({ ...base, BITABLE_URL: "https://acme.feishu.cn/base/basetoken" })),
    "https://acme.feishu.cn/base/basetoken",
  );
  assert.throws(() => loadConfig({ ...base, FEISHU_APP_SECRET: "" }), /FEISHU_APP_SECRET/);
  assert.throws(() => loadConfig({ ...base, BITABLE_TABLE_ID: undefined }), /BITABLE_TABLE_ID/);
});
