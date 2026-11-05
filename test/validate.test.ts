import assert from "node:assert/strict";
import test from "node:test";
import { ValidationError, parsePayload, parseScreenshots, sniffImage } from "../src/validate.js";

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
