# 原站界面基线

这里保存 nvmes.com 的原有页面与交互基线，供新技术栈逐项迁移时核对；不重画或近似实现界面。官网首页、登录/注册、工作台、画布列表与编辑器默认由 React / TypeScript 渲染。

## 文件来源与校验

- 线上快照采集日期：2026-11-17，release 为 `20261110T123434Z-remove-lab`。
- 原始源码：`legacy/pure`，对应 upstream commit `167896e59196adc2d96a816191b02d3f4561f605`。
- `production/` 保留线上相对于源码归档的 `server.py`、`node_models.py`、`requirements.txt`、`static/studio.js` 原文件。这些文件未经格式化或界面修改。
- `production/manifest.json` 固定 65 个页面与配套服务文件的 SHA-256。启动前全部校验；任何不匹配均中止。
- 包含主页、登录/注册、工作台、完整画布、对话、设置和头像资源。GPU 安装下载包仍引用 `legacy/pure/agent`，不属于本次 65 个文件的一致性声明。

## 本机运行

首次准备 Python 3.12 环境：

```sh
uv venv --python 3.12 .runtime-advanced/original/.venv
uv pip install --python .runtime-advanced/original/.venv/bin/python -r baseline/production/requirements.txt
```

运行或只检查文件：

```sh
STUDIO_BACKEND=python pnpm dev:web
# 同时启动 Next.js :3000 和本机 Python 兼容 API :4101
# 使用生产构建预览：pnpm build && STUDIO_BACKEND=python pnpm start:studio
python3 scripts/preview-original.py --check
python3 scripts/list-original-routes.py --check
```

- 公开主页：`http://localhost:3000/`
- 固定原版工作台：`http://localhost:3000/studio?studio_ui=legacy`
- 画布列表：`http://localhost:3000/canvas`
- 登录信息：`.runtime-advanced/original/登录信息.txt`，仅本机保存。

运行时使用独立 SQLite 和本机媒体目录 `.runtime-advanced/original/data`；不读取线上业务数据、线上 Cookie 或模型密钥。首次启动沿用已创建的本机预览管理员凭据；没有本机凭据时生成随机密码。两个服务均监听 `127.0.0.1`，自动模型调用和支付轮询关闭。端口被占用时启动器报错退出，不终止其他进程；退出启动器会关闭它创建的两个子进程。

产品的 Python 兼容入口是 `STUDIO_BACKEND=python pnpm dev:web` 或 `STUDIO_BACKEND=python pnpm start:studio`。两者均关闭贡献接口和旧凭据，保留普通配对和消费账本。可用 `STUDIO_PORT`、`LEGACY_API_PORT`、`STUDIO_PUBLIC_URL` 和 `STUDIO_PYTHON` 指定网关、内部 API、浏览器 origin 和 Python 路径。

`pnpm preview:original` 专用于与固定原版作对照。它在 `.runtime-advanced/original-oracle` 下建立独立的 SQLite 数据库、媒体目录和登录信息。需要比较历史数据时，使用单独的测试副本。

## 与 Advanced 的边界

官网首页、登录/注册、工作台、画布列表和编辑器已有通过原版对照的 React 实现。显式回退和工作区探测失败时仍可加载固定 HTML 与静态资源。日常预览默认由原协议 Nest 处理业务请求，本文命令显式启用独立 Python 兼容 API 作对照。见 [正常工作台启动](../docs/ORIGINAL_NEST_STUDIO.md)。

Advanced 的 NestJS、PostgreSQL、Redis、插件 SDK 和模型插件代码保留；原先的 Advanced 前端仅供迁移开发，先停止原版预览，再用 `pnpm dev:web:advanced` 在 3000 端口运行。两者不可同时占用同一端口。`/advanced` 在默认原版模式下返回 404。

本机模型连接、价格、积分、历史作品与线上不同，因为业务数据与凭据未复制。原版基线文件保持不变，新实现保留原有设计和交互；不使用假数据伪装线上服务已接入。

后续迁移顺序：

1. 固定原站的页面、CSS、构建产物和 API 请求/响应契约。
2. 在原契约下逐项替换鉴权、工作区、资产、画布与任务接口，保留原界面行为。
3. 将 Muse、Flow、GPU 和其他模型调度接入插件层，验证原界面生成、取消、回填与积分行为。
4. 完成功能对照后，再按用户明确要求调整界面。

## 本轮验证

65 个本地运行文件与线上快照 SHA-256 一致。`pnpm test:studio` 使用临时原版数据库与真实 Next 生产服务器，检查 React 首页及 CSP，逐字节比较显式回退工作台及画布的固定 HTML和 23 个 JS/CSS/SVG 资源，验证缓存指纹、登录/退出、CSRF、画布保存/冲突、上传、私有媒体 Range 和真实 SSE 首包。测试不会修改预览数据，也不调用真实模型或支付。

本机入口切换前另存 SQLite 备份和页面哈希，切换后确认页面正文与数据表计数不变。120 个原站 method/path 契约保存在 `contracts/routes.json`；后续分组迁移与验收约束见 `docs/UI_PARITY_MIGRATION.md`。

`pnpm test:home` 在上述临时环境增加首页浏览器对照：桌面/手机、浅色/深色、访客/登录 8 种状态的 DOM 相同且截图零像素差异，并检查主题、刷新、滚动和旧链接跳转。首次执行前安装 `pnpm exec playwright install chromium`；测试细节见 [UI 一致性迁移](../docs/UI_PARITY_MIGRATION.md)。

`pnpm test:auth` 增加登录/注册与错误态的 20 项零像素差异对照，使用临时账号验证注册赠送积分、登录、账户菜单退出、表单重置、旧邀请链接及错误提示。未登录入口的 React 改造不代表认证后端迁移完成。
