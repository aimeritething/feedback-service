import type { StoredFeedback } from "./db.js";

export interface FeedbackView {
  id: string;
  kind: "issue" | "feature";
  kindLabel: string;
  description: string;
  userName: string;
  userId: string;
  userUid: string;
  appVersion: string;
  osPlatform: string;
  osRelease: string;
  osArch: string;
  productEdition: string;
  region: string;
  locale: string;
  workspaceId: string;
  sessionId: string;
  hasLogs: boolean;
  createdAt: Date;
  createdAtText: string;
}

export const KIND_LABEL: Record<FeedbackView["kind"], string> = { issue: "问题报告", feature: "功能建议" };

export const BITABLE_FIELDS = {
  id: "编号",
  kind: "类型",
  description: "描述",
  screenshots: "截图",
  status: "状态",
  userName: "用户",
  userId: "用户 ID",
  appVersion: "版本",
  osPlatform: "平台",
  osRelease: "系统版本",
  osArch: "架构",
  productEdition: "产品版本",
  region: "区域",
  locale: "语言",
  workspaceId: "Workspace",
  sessionId: "Session",
  logs: "日志",
  createdAt: "提交时间",
} as const;

export function projectFeedback(record: StoredFeedback, timeZone: string): FeedbackView {
  const { payload, user } = record;
  const env = payload.environment;
  return {
    id: record.id,
    kind: payload.kind,
    kindLabel: KIND_LABEL[payload.kind],
    description: payload.description,
    userName: user.name ?? "",
    userId: user.id,
    userUid: user.uid,
    appVersion: env.appVersion,
    osPlatform: env.osPlatform,
    osRelease: env.osRelease,
    osArch: env.osArch,
    productEdition: env.productEdition ?? "",
    region: hostOf(env.region),
    locale: payload.locale,
    workspaceId: payload.context?.workspaceId ?? "",
    sessionId: payload.context?.sessionId ?? "",
    hasLogs: record.logsKey !== null,
    createdAt: record.createdAt,
    createdAtText: formatTime(record.createdAt, timeZone),
  };
}

function hostOf(region: string): string {
  try {
    return new URL(region).hostname;
  } catch {
    return region;
  }
}

function formatTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function toBitableFields(
  view: FeedbackView,
  fileTokens: readonly string[],
  logsToken: string | null = null,
): Record<string, unknown> {
  const f = BITABLE_FIELDS;
  const fields: Record<string, unknown> = {
    [f.id]: view.id,
    [f.kind]: view.kindLabel,
    [f.description]: view.description,
    [f.status]: "新",
    [f.userId]: view.userId,
    [f.appVersion]: view.appVersion,
    [f.osPlatform]: view.osPlatform,
    [f.osRelease]: view.osRelease,
    [f.osArch]: view.osArch,
    [f.region]: view.region,
    [f.locale]: view.locale,
    [f.createdAt]: view.createdAt.getTime(),
  };
  const optional: [string, string][] = [
    [f.userName, view.userName],
    [f.productEdition, view.productEdition],
    [f.workspaceId, view.workspaceId],
    [f.sessionId, view.sessionId],
  ];
  for (const [name, value] of optional) if (value) fields[name] = value;
  if (fileTokens.length > 0) fields[f.screenshots] = fileTokens.map((file_token) => ({ file_token }));
  if (logsToken) fields[f.logs] = [{ file_token: logsToken }];
  return fields;
}

export function toCardVariables(
  view: FeedbackView,
  imageKeys: readonly string[],
  recordUrl: string,
): Record<string, unknown> {
  const issue = view.kind === "issue";
  return {
    kind: view.kind,
    kind_label: view.kindLabel,
    header_color: issue ? "red" : "blue",
    header_icon: issue ? "warning_outlined" : "edit_outlined",
    summary: `[${view.kindLabel}] ${view.description.split("\n")[0]?.slice(0, 60) ?? ""}`,
    subtitle: [`Sealos ${view.appVersion}`, `${platformLabel(view.osPlatform)} ${view.osArch}`, view.region].join(" · "),
    edition: view.productEdition || "-",
    locale: view.locale,
    // 模板把用户字段放在 plain_text 里，飞书不解析，原文直接给，不转义。
    description: view.description,
    user_name: view.userName || "-",
    user_id: view.userId,
    os: `${view.osPlatform} ${view.osRelease} ${view.osArch}`,
    version: `${view.appVersion} · ${view.productEdition || "-"}`,
    region: view.region,
    workspace: view.workspaceId || "—",
    session: view.sessionId || "—",
    // 群里只标有没有，文件在表格里拿：没人在手机上解 zip。
    logs: view.hasLogs ? "附日志" : "—",
    id: view.id,
    created_at: view.createdAtText,
    record_url: recordUrl,
    images: imageKeys.map((img_key) => ({ img_key })),
  };
}

function platformLabel(platform: string): string {
  return { darwin: "macOS", win32: "Windows", linux: "Linux" }[platform] ?? platform;
}
