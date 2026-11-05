import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  S3_ENDPOINT: z
    .string()
    .trim()
    .min(1)
    .transform((raw) => (/^https?:\/\//i.test(raw) ? raw : `${raw.endsWith(".svc.cluster.local") ? "http" : "https"}://${raw}`))
    .pipe(z.string().url()),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  ALLOWED_REGIONS: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(20),

  FEISHU_BASE_URL: z.string().url().default("https://open.feishu.cn"),
  FEISHU_APP_ID: z.string().min(1),
  FEISHU_APP_SECRET: z.string().min(1),
  FEISHU_CHAT_ID: z.string().trim().optional().or(z.literal("")),
  FEISHU_CARD_TEMPLATE_ID: z.string().trim().optional().or(z.literal("")),
  BITABLE_APP_TOKEN: z.string().min(1),
  BITABLE_TABLE_ID: z.string().min(1),
  BITABLE_URL: z.string().url().optional().or(z.literal("")),
  SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  DISPLAY_TIMEZONE: z.string().min(1).default("Asia/Shanghai"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid configuration: ${issues}`);
  }
  return parsed.data;
}

export function bitableUrl(config: Pick<Config, "BITABLE_URL" | "BITABLE_APP_TOKEN">): string {
  return config.BITABLE_URL || `https://feishu.cn/base/${config.BITABLE_APP_TOKEN}`;
}
