import { z } from "zod";

export const DESCRIPTION_MAX = 4000;
export const SCREENSHOT_MAX_COUNT = 5;
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

export const payloadSchema = z.object({
  kind: z.enum(["issue", "feature"]),
  description: z.string().trim().min(1).max(DESCRIPTION_MAX),
  locale: z.string().trim().min(1).max(16),
  context: z
    .object({
      workspaceId: z.string().trim().min(1).optional(),
      sessionId: z.string().trim().min(1).optional(),
    })
    .optional(),
  environment: z.object({
    appVersion: z.string().max(64),
    osPlatform: z.string().max(32),
    osRelease: z.string().max(64),
    osArch: z.string().max(32),
    productEdition: z.enum(["china", "global"]).nullable(),
    region: z.string().max(256),
  }),
});
export type Payload = z.infer<typeof payloadSchema>;

export type ImageKind = "png" | "jpeg" | "webp";

export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "webp";
  return null;
}

export class ValidationError extends Error {
  constructor(
    readonly status: 400 | 413 | 415 | 422,
    message: string,
  ) {
    super(message);
  }
}

export type Screenshot = { kind: ImageKind; bytes: Uint8Array };

export function parsePayload(raw: unknown): Payload {
  if (typeof raw !== "string") throw new ValidationError(400, "payload field missing");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ValidationError(400, "payload is not JSON");
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) throw new ValidationError(422, "payload invalid");
  return parsed.data;
}

export async function parseScreenshots(files: readonly File[]): Promise<Screenshot[]> {
  if (files.length > SCREENSHOT_MAX_COUNT) throw new ValidationError(422, "too many screenshots");
  const shots: Screenshot[] = [];
  for (const file of files) {
    if (file.size > SCREENSHOT_MAX_BYTES) throw new ValidationError(413, "screenshot too large");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffImage(bytes);
    if (!sniffed) throw new ValidationError(415, "screenshot is not png/jpeg/webp");
    shots.push({ kind: sniffed, bytes });
  }
  return shots;
}
