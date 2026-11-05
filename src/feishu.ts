import type { ImageKind, ObjectKind } from "./validate.js";

export interface FeishuClient {
  uploadImage(bytes: Uint8Array, kind: ImageKind): Promise<string>;
  uploadAttachment(name: string, bytes: Uint8Array, kind: ObjectKind): Promise<string>;
  createRecord(fields: Record<string, unknown>): Promise<string>;
  listFieldNames(): Promise<string[]>;
  sendCard(chatId: string, content: unknown): Promise<string>;
}

export interface FeishuOptions {
  baseUrl: string;
  appId: string;
  appSecret: string;
  appToken: string;
  tableId: string;
}

export class FeishuError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly logId?: string,
  ) {
    super(`feishu ${code}: ${message}`);
  }
}

const MIME: Record<ObjectKind, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", zip: "application/zip" };

type Envelope<T> = { code: number; msg?: string; data?: T; tenant_access_token?: string; expire?: number };

export function createFeishuClient(fetchImpl: typeof fetch, opts: FeishuOptions): FeishuClient {
  const base = opts.baseUrl.replace(/\/+$/, "");
  let token: { value: string; expiresAt: number } | null = null;

  async function request<T>(path: string, init: RequestInit & { auth?: boolean }): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.auth !== false) headers.set("Authorization", `Bearer ${await getToken()}`);
    const resp = await fetchImpl(`${base}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(15_000) });
    let body: Envelope<T>;
    try {
      body = (await resp.json()) as Envelope<T>;
    } catch {
      throw new FeishuError(resp.status, `non-JSON response from ${path}`);
    }
    if (!resp.ok || body.code !== 0) {
      throw new FeishuError(body.code ?? resp.status, body.msg ?? resp.statusText, resp.headers.get("x-tt-logid") ?? undefined);
    }
    return (body.data ?? (body as unknown)) as T;
  }

  async function getToken(): Promise<string> {
    if (token && token.expiresAt > Date.now()) return token.value;
    const body = await request<Envelope<never>>("/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      auth: false,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: opts.appId, app_secret: opts.appSecret }),
    });
    if (!body.tenant_access_token) throw new FeishuError(-1, "tenant_access_token missing");
    token = { value: body.tenant_access_token, expiresAt: Date.now() + ((body.expire ?? 7200) - 60) * 1000 };
    return token.value;
  }

  const blobOf = (bytes: Uint8Array, kind: ObjectKind) => new Blob([bytes as unknown as ArrayBuffer], { type: MIME[kind] });
  const records = `/open-apis/bitable/v1/apps/${opts.appToken}/tables/${opts.tableId}`;

  return {
    async uploadImage(bytes, kind) {
      const form = new FormData();
      form.append("image_type", "message");
      form.append("image", blobOf(bytes, kind), `screenshot.${kind}`);
      const data = await request<{ image_key: string }>("/open-apis/im/v1/images", { method: "POST", body: form });
      return data.image_key;
    },
    async uploadAttachment(name, bytes, kind) {
      const form = new FormData();
      form.append("file_name", name);
      form.append("parent_type", "bitable_image");
      form.append("parent_node", opts.appToken);
      form.append("size", String(bytes.byteLength));
      form.append("file", blobOf(bytes, kind), name);
      const data = await request<{ file_token: string }>("/open-apis/drive/v1/medias/upload_all", { method: "POST", body: form });
      return data.file_token;
    },
    async createRecord(fields) {
      const data = await request<{ record: { record_id: string } }>(`${records}/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      return data.record.record_id;
    },
    async listFieldNames() {
      const names: string[] = [];
      let pageToken = "";
      do {
        const q = new URLSearchParams({ page_size: "100" });
        if (pageToken) q.set("page_token", pageToken);
        const data = await request<{ items?: { field_name: string }[]; has_more?: boolean; page_token?: string }>(
          `${records}/fields?${q}`,
          { method: "GET" },
        );
        names.push(...(data.items ?? []).map((f) => f.field_name));
        pageToken = data.has_more && data.page_token ? data.page_token : "";
      } while (pageToken);
      return names;
    },
    async sendCard(chatId, content) {
      const data = await request<{ message_id: string }>("/open-apis/im/v1/messages?receive_id_type=chat_id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receive_id: chatId, msg_type: "interactive", content: JSON.stringify(content) }),
      });
      return data.message_id;
    },
  };
}
