import assert from "node:assert/strict";
import test from "node:test";
import { buildCardContent, loadCardTemplate, renderCard } from "../src/card.js";
import type { StoredFeedback } from "../src/db.js";
import { BITABLE_FIELDS, projectFeedback, toBitableFields, toCardVariables } from "../src/projection.js";

const record = (over: Partial<StoredFeedback["payload"]> = {}): StoredFeedback => ({
  id: "fb_0123456789abcdef0123",
  payload: {
    kind: "issue",
    description: "Deploy *button* does nothing\nsecond line",
    locale: "zh-CN",
    context: { workspaceId: "ns-acme" },
    environment: {
      appVersion: "0.10.3",
      osPlatform: "darwin",
      osRelease: "25.4.0",
      osArch: "arm64",
      productEdition: "china",
      region: "https://hzh.sealos.run",
    },
    ...over,
  },
  user: { uid: "u-1", id: "jamie", name: "19858195373" },
  screenshotKeys: ["screenshots/fb_x/1.png"],
  createdAt: new Date("2026-11-05T04:12:00Z"),
});

test("projectFeedback flattens the record, host-only region, time in display zone", () => {
  const view = projectFeedback(record(), "Asia/Shanghai");
  assert.equal(view.kindLabel, "问题报告");
  assert.equal(view.region, "hzh.sealos.run");
  assert.equal(view.createdAtText, "11-05 12:12");
  assert.equal(view.sessionId, "");
});

test("toBitableFields writes every column, skips blanks, attachments as file_token list", () => {
  const fields = toBitableFields(projectFeedback(record(), "Asia/Shanghai"), ["tok1", "tok2"]);
  assert.equal(fields[BITABLE_FIELDS.kind], "问题报告");
  assert.equal(fields[BITABLE_FIELDS.status], "新");
  assert.equal(fields[BITABLE_FIELDS.region], "hzh.sealos.run");
  assert.equal(fields[BITABLE_FIELDS.createdAt], Date.parse("2026-11-05T04:12:00Z"));
  assert.deepEqual(fields[BITABLE_FIELDS.screenshots], [{ file_token: "tok1" }, { file_token: "tok2" }]);
  assert.equal(BITABLE_FIELDS.sessionId in fields, false, "blank optional columns are omitted");
  const noShots = toBitableFields(projectFeedback(record(), "Asia/Shanghai"), []);
  assert.equal(BITABLE_FIELDS.screenshots in noShots, false);
});

test("toCardVariables: colours by kind, passes user text through raw (template renders it as plain_text)", () => {
  const issue = toCardVariables(projectFeedback(record(), "Asia/Shanghai"), ["img1"], "https://x/base?record=r");
  assert.equal(issue["header_color"], "red");
  assert.equal(issue["description"], "Deploy *button* does nothing\nsecond line");
  assert.equal(issue["summary"], "[问题报告] Deploy *button* does nothing");
  assert.equal(issue["subtitle"], "Sealos 0.10.3 · macOS arm64 · hzh.sealos.run");
  assert.deepEqual(issue["images"], [{ img_key: "img1" }]);
  const feature = toCardVariables(projectFeedback(record({ kind: "feature" }), "Asia/Shanghai"), [], "u");
  assert.equal(feature["header_color"], "blue");
  assert.equal(feature["kind_label"], "功能建议");
});

// 卡片发到内部飞书群：用户能控制的字段（描述、昵称、Workspace、会话、系统、版本、区域）
// 一律进 plain_text，不能出现在 markdown 里，否则可以塞钓鱼链接或 @所有人。
test("repo template: user-controlled values never land in a markdown element", async () => {
  const template = await loadCardTemplate(new URL("../templates/feedback-card.json", import.meta.url).pathname);
  const evil = "[login](https://evil.example) <at id=all></at>";
  const injected = {
    ...record({
      description: evil,
      context: { workspaceId: evil, sessionId: evil },
      environment: {
        appVersion: evil,
        osPlatform: evil,
        osRelease: evil,
        osArch: evil,
        productEdition: "china",
        region: evil,
      },
    }),
    user: { uid: "u-1", id: "jamie", name: evil },
  };
  const card = buildCardContent(
    { template },
    toCardVariables(projectFeedback(injected, "Asia/Shanghai"), [], "https://x"),
  );

  const markdown: string[] = [];
  const plain: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj["tag"] === "markdown") markdown.push(String(obj["content"]));
    if (obj["tag"] === "plain_text") plain.push(String(obj["content"]));
    Object.values(obj).forEach(visit);
  };
  visit(card);

  for (const content of markdown) {
    assert.equal(content.includes("evil.example"), false, `markdown carries user text: ${content}`);
    assert.equal(content.includes("<at"), false, `markdown carries user text: ${content}`);
  }
  // 描述和每一行信息都还在，只是以纯文本出现。
  for (const label of ["用户", "空间", "会话", "系统", "版本", "区域"]) {
    assert.ok(plain.some((text) => text.startsWith(label) && text.includes(evil)), `${label} row missing`);
  }
  assert.ok(plain.includes(evil), "description rendered verbatim as plain_text");
});

test("renderCard substitutes variables, drops $if blocks, builds the image block", () => {
  const template = {
    title: "{{kind_label}}",
    url: "{{record_url}}",
    raw: "{{images}}",
    elements: [
      { tag: "markdown", content: "a {{id}} b" },
      { $if: "note", tag: "markdown", content: "{{note}}" },
      { $images: {} },
      { nested: [{ $if: "workspace", v: "{{workspace}}" }] },
    ],
  };
  const none = renderCard(template, { kind_label: "问题报告", record_url: "https://x", id: "fb_1", note: "", images: [], workspace: "ns" }) as Record<string, unknown>;
  assert.equal(none["title"], "问题报告");
  assert.deepEqual(none["raw"], []);
  assert.deepEqual(none["elements"], [{ tag: "markdown", content: "a fb_1 b" }, { nested: [{ v: "ns" }] }]);

  const one = renderCard(template, { note: "x", images: [{ img_key: "k1" }] }) as { elements: Record<string, unknown>[] };
  assert.equal(one.elements[1]?.["content"], "x");
  assert.equal(one.elements[2]?.["tag"], "img");
  assert.equal(one.elements[2]?.["img_key"], "k1");

  const many = renderCard(template, { images: [{ img_key: "k1" }, { img_key: "k2" }, { img_key: "k3" }] }) as { elements: Record<string, unknown>[] };
  assert.equal(many.elements[1]?.["tag"], "img_combination");
  assert.deepEqual(many.elements[1]?.["img_list"], [{ img_key: "k1" }, { img_key: "k2" }, { img_key: "k3" }]);
});

test("buildCardContent prefers a Feishu template id, else renders the repo template", async () => {
  const vars = { kind_label: "功能建议", images: [] };
  assert.deepEqual(buildCardContent({ templateId: "AAq", template: {} }, vars), {
    type: "template",
    data: { template_id: "AAq", template_variable: vars },
  });
  const template = await loadCardTemplate(new URL("../templates/feedback-card.json", import.meta.url).pathname);
  const card = buildCardContent({ template }, toCardVariables(projectFeedback(record(), "Asia/Shanghai"), [], "https://x")) as {
    schema: string;
    header: { template: string };
    body: { elements: unknown[] };
  };
  assert.equal(card.schema, "2.0");
  assert.equal(card.header.template, "red");
  assert.equal(card.body.elements.length, 3, "no screenshots → no image block");
});
