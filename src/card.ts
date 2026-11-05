// 模板语法：{{name}} 替换变量；"$if": "name" 变量为空时删除该对象；{"$images": {}} 渲染截图。
import { readFile } from "node:fs/promises";

export type CardVariables = Record<string, unknown>;

export async function loadCardTemplate(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export function buildCardContent(
  source: { templateId?: string | undefined; template?: unknown },
  vars: CardVariables,
): unknown {
  if (source.templateId) return { type: "template", data: { template_id: source.templateId, template_variable: vars } };
  if (source.template === undefined) throw new Error("no card template");
  return renderCard(source.template, vars);
}

const REMOVE = Symbol("remove");

export function renderCard(template: unknown, vars: CardVariables): unknown {
  const out = walk(template, vars);
  return out === REMOVE ? null : out;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function walk(node: unknown, vars: CardVariables): unknown {
  if (typeof node === "string") return substitute(node, vars);
  if (Array.isArray(node)) return node.map((item) => walk(item, vars)).filter((item) => item !== REMOVE);
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj["$if"] === "string" && isEmpty(vars[obj["$if"]])) return REMOVE;
    if ("$images" in obj) return imagesBlock(vars["images"], obj["$images"]);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "$if") continue;
      const rendered = walk(value, vars);
      if (rendered !== REMOVE) result[key] = rendered;
    }
    return result;
  }
  return node;
}

function substitute(text: string, vars: CardVariables): unknown {
  const whole = /^\{\{(\w+)\}\}$/.exec(text);
  if (whole) return vars[whole[1] ?? ""] ?? "";
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? "" : String(value);
  });
}

function imagesBlock(images: unknown, options: unknown): unknown {
  const list = Array.isArray(images) ? (images as { img_key: string }[]) : [];
  const opts = (options && typeof options === "object" ? options : {}) as { corner_radius?: string };
  const corner = opts.corner_radius ?? "6px";
  if (list.length === 0) return REMOVE;
  if (list.length === 1) {
    return {
      tag: "img",
      img_key: list[0]?.img_key,
      alt: { tag: "plain_text", content: "截图" },
      scale_type: "fit_horizontal",
      corner_radius: corner,
    };
  }
  return {
    tag: "img_combination",
    combination_mode: "bisect",
    corner_radius: corner,
    img_list: list.slice(0, 6).map(({ img_key }) => ({ img_key })),
  };
}
