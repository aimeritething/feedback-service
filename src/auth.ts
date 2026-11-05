import { z } from "zod";

const authInfoSchema = z.object({
  code: z.number().optional(),
  data: z
    .object({
      info: z.object({
        uid: z.string().min(1),
        id: z.string().min(1),
        name: z.string().nullish(),
        nickname: z.string().nullish(),
      }),
    })
    .optional(),
});

export type SealosUser = { uid: string; id: string; name: string | null };

export class AuthError extends Error {
  constructor(
    readonly status: 400 | 401 | 502,
    message: string,
  ) {
    super(message);
  }
}

export function resolveRegion(raw: string | undefined, allowed: readonly string[]): string {
  if (!raw) throw new AuthError(400, "missing region");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AuthError(400, "invalid region");
  }
  if (url.protocol !== "https:") throw new AuthError(400, "region must be https");
  if (!allowed.includes(url.hostname.toLowerCase())) throw new AuthError(400, "region not allowed");
  return url.origin;
}

export async function verifyToken(
  fetchImpl: typeof fetch,
  region: string,
  token: string | undefined,
): Promise<SealosUser> {
  if (!token) throw new AuthError(401, "missing token");
  let resp: Response;
  try {
    resp = await fetchImpl(`${region}/api/auth/info`, {
      headers: { Authorization: token },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AuthError(502, "region unreachable");
  }
  if (resp.status === 401) throw new AuthError(401, "token rejected");
  let body: unknown = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }
  const parsed = authInfoSchema.safeParse(body);
  if (!resp.ok || !parsed.success) throw new AuthError(502, "auth info malformed");
  if (parsed.data.code === 401) throw new AuthError(401, "token rejected");
  const info = parsed.data.data?.info;
  if (!info) throw new AuthError(502, "auth info missing");
  return { uid: info.uid, id: info.id, name: info.nickname ?? info.name ?? null };
}
