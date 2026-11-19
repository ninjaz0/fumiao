# 本地工作台

## 持久预览

先准备专用于这套工作台的 PostgreSQL 数据库和持久 Redis 实例，Redis 启用持久化并使用 `noeviction`。使用 Node 24 和项目的 pnpm。创建本机专用配置 `.env.studio-nest`，权限设为 0600。以下为配置格式，连接地址和密钥按自己的实例填写。

```dotenv
DATABASE_URL=postgresql://studio:替换为专用数据库密码@127.0.0.1:55432/studio
REDIS_URL=redis://127.0.0.1:56379
ENCRYPTION_KEY=替换为固定的32字节Base64密钥
MEDIA_DIRECTORY=.runtime-advanced/studio-nest/objects
STUDIO_RUNTIME_DIRECTORY=.runtime-advanced/studio-nest
# 迁移已有工作区时必须设置，值与导出时的 --source 一致。
# STUDIO_LEGACY_SOURCE=旧实例标识
```

可用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` 为新库生成密钥，重启和恢复时继续使用同一密钥。磁盘目录需提前创建并由运行用户访问，权限设为 0700。使用 S3 时设置私有 `S3_BUCKET`，按需配置 `S3_ENDPOINT`、`S3_REGION`、`S3_PATH_STYLE` 和凭据，签名 URL 的主机须可被浏览器访问，并将 `STUDIO_MEDIA_ORIGIN` 设为对应的源地址。生产配置保存在版本库和镜像之外。多副本和对象存储验收见 [运维说明](OPERATIONS.md)。

```sh
mkdir -m 700 -p .runtime-advanced/studio-nest/objects
STUDIO_ENV_FILE=.env.studio-nest pnpm dev:web
# 生产构建预览，先停止开发预览
pnpm build
STUDIO_ENV_FILE=.env.studio-nest pnpm start:studio
```

启动器读取 `STUDIO_ENV_FILE` 或仓库根目录的 `.env`，当前进程变量优先。它应用 PostgreSQL 迁移并初始化实例的插件目录。全新实例由管理员在「设置 → 插件」安装模型包，已有实例沿用原目录。启动器确认存在活跃管理员、指定导入已完成、私有磁盘目录可用且 Redis 可连接后，再启动工作台。通过 `http://localhost:3000/studio` 访问；可配置 `STUDIO_PORT`、`LEGACY_API_PORT` 和浏览器 origin `STUDIO_PUBLIC_URL`（也可使用 `PUBLIC_URL`）。配置或服务错误会退出并提示检查项。网关遇到后端连接错误返回 502，写请求只有一个固定上游。

已有工作区按 [备份和导入步骤](MIGRATION.md#迁移前) 操作。全新安装才运行以下命令，先将自己的 `ADMIN_PASSWORD` 注入当前进程。积分和提供方连接随后由管理员配置。

```sh
API_PROTOCOL=original node --env-file=.env.studio-nest --import tsx scripts/migrate.ts
API_PROTOCOL=original node --env-file=.env.studio-nest --import tsx scripts/bootstrap.ts
```

### HTTPS 入口

将 TLS 反向代理的上游指向 Next 的 HTTP 监听地址。保留公开的 `Host` 和浏览器发来的 `Origin`，由反向代理覆盖转发头，将 `X-Forwarded-Proto` 设为 `https`，并逐段转发 SSE 响应。Nest 的 `PUBLIC_URL` 必须与浏览器 origin 完全一致，包括 `https://` 和非默认端口。直接访问 HTTP 时使用相应的 HTTP origin。启动器会自动为 Next 设置 `LEGACY_API_INTERNAL_URL`。分开启动时，将该变量指向内网的原协议 Nest，Compose 默认使用 `http://api:4000`。

回环复跑使用 `pnpm exec playwright install firefox`、`pnpm build` 和 `pnpm test:studio:https`。需要 `openssl`、NSS `certutil`、PostgreSQL 和 Redis，可用 `STUDIO_CERTUTIL`、`PG_BINDIR`、`REDIS_SERVER` 指定路径。脚本创建临时 Firefox profile，只在该 profile 中导入本次生成的 CA，使用临时私有磁盘和模拟聊天 provider。

同一实例由多处受信任入口访问时，将 `PUBLIC_URL` 设为用户访问的主 HTTPS 源地址，支付回跳使用这个地址。其他入口可在 API 的 `STUDIO_ADDITIONAL_ORIGINS` 中显式指定，例如 `http://localhost:3000`。多个源用逗号分隔，每项包括协议、主机和实际使用的端口。只添加由本实例控制的页面来源。
