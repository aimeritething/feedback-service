import pg from "pg";
import type { SealosUser } from "./auth.js";
import type { Payload } from "./validate.js";

export interface FeedbackRecord {
  id: string;
  payload: Payload;
  user: SealosUser;
  screenshotKeys: string[];
}

export type StoredFeedback = FeedbackRecord & { createdAt: Date };

export interface Db {
  insert(record: FeedbackRecord): Promise<StoredFeedback>;
  countRecent(userUid: string, sinceMs: number): Promise<number>;
  listUnsynced(limit: number): Promise<StoredFeedback[]>;
  markSynced(id: string, feishuRecordId: string): Promise<void>;
  markSyncFailed(id: string, error: string): Promise<void>;
  close(): Promise<void>;
}

type Row = {
  id: string;
  kind: "issue" | "feature";
  description: string;
  locale: string;
  user_uid: string;
  user_id: string;
  user_name: string | null;
  workspace_id: string | null;
  session_id: string | null;
  app_version: string;
  os_platform: string;
  os_release: string;
  os_arch: string;
  product_edition: "china" | "global" | null;
  region: string;
  screenshots: string[];
  created_at: Date;
};

function fromRow(row: Row): StoredFeedback {
  const context: Payload["context"] = {};
  if (row.workspace_id) context.workspaceId = row.workspace_id;
  if (row.session_id) context.sessionId = row.session_id;
  const payload: Payload = {
    kind: row.kind,
    description: row.description,
    locale: row.locale,
    environment: {
      appVersion: row.app_version,
      osPlatform: row.os_platform,
      osRelease: row.os_release,
      osArch: row.os_arch,
      productEdition: row.product_edition,
      region: row.region,
    },
  };
  if (Object.keys(context).length > 0) payload.context = context;
  return {
    id: row.id,
    payload,
    user: { uid: row.user_uid, id: row.user_id, name: row.user_name },
    screenshotKeys: row.screenshots,
    createdAt: row.created_at,
  };
}

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString });
  return {
    async insert(record) {
      const { id, payload, user, screenshotKeys } = record;
      const env = payload.environment;
      const result = await pool.query<{ created_at: Date }>(
        `INSERT INTO feedback (
           id, kind, description, locale,
           user_uid, user_id, user_name, workspace_id, session_id,
           app_version, os_platform, os_release, os_arch, product_edition, region, screenshots
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING created_at`,
        [
          id,
          payload.kind,
          payload.description,
          payload.locale,
          user.uid,
          user.id,
          user.name,
          payload.context?.workspaceId ?? null,
          payload.context?.sessionId ?? null,
          env.appVersion,
          env.osPlatform,
          env.osRelease,
          env.osArch,
          env.productEdition,
          env.region,
          JSON.stringify(screenshotKeys),
        ],
      );
      return { ...record, createdAt: result.rows[0]?.created_at ?? new Date() };
    },
    async countRecent(userUid, sinceMs) {
      const result = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM feedback WHERE user_uid = $1 AND created_at >= to_timestamp($2 / 1000.0)`,
        [userUid, sinceMs],
      );
      return Number(result.rows[0]?.count ?? "0");
    },
    async listUnsynced(limit) {
      const result = await pool.query<Row>(
        `SELECT * FROM feedback WHERE synced_at IS NULL ORDER BY created_at ASC LIMIT $1`,
        [limit],
      );
      return result.rows.map(fromRow);
    },
    async markSynced(id, feishuRecordId) {
      await pool.query(
        `UPDATE feedback SET feishu_record_id = $2, synced_at = now(), sync_error = NULL WHERE id = $1`,
        [id, feishuRecordId],
      );
    },
    async markSyncFailed(id, error) {
      await pool.query(`UPDATE feedback SET sync_error = $2 WHERE id = $1`, [id, error.slice(0, 1000)]);
    },
    close: () => pool.end(),
  };
}
