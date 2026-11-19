# Pure 基线归档

原 FastAPI、原生 JavaScript 工作台、GPU 运行时、Muse/Flow 服务与桌面客户端位于 `legacy/pure/`。原说明保存在 `legacy/pure/README.md`。

新版本入口为 `apps/`、`packages/` 和 `plugins/`。默认 Docker 镜像不包含旧应用。GPU v2 执行端可以连接已部署的旧 H3/Breeze 推理运行时，模型提供方插件通过 HTTP 连接独立运行的 Muse/Flow 服务。

这份归档保留未迁移的旧交互和运维能力用于比对、回滚及后续迁移；它不在新平台进程中执行。
