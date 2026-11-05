-- Issue 附带的 Diagnostic logs（zip）在 S3 里的 key；feature 与没勾选的 issue 为 NULL。
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS logs_key TEXT;
