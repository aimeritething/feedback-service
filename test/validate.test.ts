import assert from "node:assert/strict";
import test from "node:test";
import { ValidationError, parseLogs, parsePayload, parseScreenshots, sniffImage, sniffZip } from "../src/validate.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

const payload = () => ({
  kind: "issue",
  description: "Deploy button does nothing",
  locale: "zh-CN",
  environment: {
    appVersion: "0.10.3",
    osPlatform: "darwin",
    osRelease: "25.4.0",
    osArch: "arm64",
    productEdition: "china",
    region: "https://hzh.sealos.run",
  },
});

test("sniffImage recognises png / jpeg / webp by magic bytes only", () => {
  assert.equal(sniffImage(PNG), "png");
  assert.equal(sniffImage(JPEG), "jpeg");
  assert.equal(sniffImage(WEBP), "webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg/>")), null);
});

test("parsePayload accepts the desktop contract and rejects bad shapes", () => {
  assert.equal(parsePayload(JSON.stringify(payload())).kind, "issue");
  assert.throws(() => parsePayload(undefined), (e: unknown) => e instanceof ValidationError && e.status === 400);
  assert.throws(() => parsePayload("{"), (e: unknown) => e instanceof ValidationError && e.status === 400);
  assert.throws(
    () => parsePayload(JSON.stringify({ ...payload(), description: "   " })),
    (e: unknown) => e instanceof ValidationError && e.status === 422,
  );
});

test("parseScreenshots enforces count, size and type rules", async () => {
  const png = new File([PNG], "a.png", { type: "image/png" });
  assert.equal((await parseScreenshots([png]))[0]?.kind, "png");
  await assert.rejects(
    parseScreenshots(Array.from({ length: 6 }, () => png)),
    (e: unknown) => (e as ValidationError).status === 422,
  );
  const fake = new File([new TextEncoder().encode("hello")], "a.png", { type: "image/png" });
  await assert.rejects(parseScreenshots([fake]), (e: unknown) => (e as ValidationError).status === 415);
  const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
  await assert.rejects(parseScreenshots([huge]), (e: unknown) => (e as ValidationError).status === 413);
});

test("sniffZip / parseLogs accept zip by magic bytes only and enforce the size limit", async () => {
  assert.equal(sniffZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])), true);
  assert.equal(sniffZip(new Uint8Array([0x50, 0x4b, 0x05, 0x06])), true, "empty archive");
  assert.equal(sniffZip(new Uint8Array([0x50, 0x4b])), false);
  assert.equal(sniffZip(new TextEncoder().encode("PK but text")), false);
  assert.equal(await parseLogs(undefined), null);
  const ok = await parseLogs(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9])], "x.zip"));
  assert.deepEqual(ok, { kind: "zip", bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9]) });
  await assert.rejects(
    parseLogs(new File([new Uint8Array(20 * 1024 * 1024 + 1)], "x.zip")),
    (e: unknown) => e instanceof ValidationError && e.status === 413,
  );
  await assert.rejects(
    parseLogs(new File([new TextEncoder().encode("nope")], "x.zip", { type: "application/zip" })),
    (e: unknown) => e instanceof ValidationError && e.status === 415,
  );
});
