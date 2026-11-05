# feedback-service

Sealos 桌面端的反馈服务：校验登录态，落库、存截图，写入飞书多维表格并往群里发卡片。

```sh
pnpm install
cp .env.example .env
pnpm dev
```

- 配置见 `.env.example`。
- 飞书应用需要权限：发送消息、上传图片、多维表格读写、云空间上传素材。
- 表格列名见 `src/projection.ts` 的 `BITABLE_FIELDS`，启动时校验。
- 卡片模板在 `templates/feedback-card.json`，语法见 `src/card.ts`。
