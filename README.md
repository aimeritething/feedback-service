# feedback-service

Sealos 桌面端的反馈服务：校验登录态，落库、存截图和诊断日志 zip，写入飞书多维表格并往群里发卡片。

- `POST /v1/feedback` 是 multipart：`payload`（JSON）、`screenshots`（最多 5 张图片）、`logs`（可选，issue 才有，zip ≤ 20 MB，按文件头验）。
- 日志 zip 存 S3 `logs/{id}/diagnostic-logs.zip`，同步到多维表格的「日志」附件列；群卡片只标「附日志」。

```sh
pnpm install
cp .env.example .env
pnpm dev
```

- 配置见 `.env.example`。
- 飞书应用需要权限：发送消息、上传图片、多维表格读写、云空间上传素材。
- 表格列名见 `src/projection.ts` 的 `BITABLE_FIELDS`，启动时校验。
- 卡片模板在 `templates/feedback-card.json`，语法见 `src/card.ts`。
