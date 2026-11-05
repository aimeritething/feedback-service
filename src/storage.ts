import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Config } from "./config.js";
import type { ObjectKind } from "./validate.js";

export type StoredObject = { kind: ObjectKind; bytes: Uint8Array };

export interface Storage {
  put(key: string, bytes: Uint8Array, kind: ObjectKind): Promise<void>;
  get(key: string): Promise<StoredObject>;
}

const CONTENT_TYPES: Record<ObjectKind, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  zip: "application/zip",
};

export function kindOfKey(key: string): ObjectKind {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "png" || ext === "webp" || ext === "zip") return ext;
  return "jpeg";
}

export function createS3Storage(config: Config): Storage {
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
  });
  return {
    async put(key, bytes, kind) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: key,
          Body: bytes,
          ContentType: CONTENT_TYPES[kind],
        }),
      );
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
      if (!result.Body) throw new Error(`object ${key} has no body`);
      return { kind: kindOfKey(key), bytes: await result.Body.transformToByteArray() };
    },
  };
}
