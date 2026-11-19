# 源码范围与恢复说明

当前仓库为 [fumiao-aigc-pure](https://github.com/ninjaz0/fumiao-aigc-pure)，默认分支 `main`，不包含 Lab 功能。完整版本见 [fumiao-aigc](https://github.com/ninjaz0/fumiao-aigc)。改动与验证范围见 [PURE.md](PURE.md)。

本仓库是 2026-11-10 当前“弗淼 AIGC”主项目的源码快照。创建仓库与上传源码没有触发网站部署，也没有合并独立的 Opus/Gemini UI 试验副本。它记录本地开发状态，不表示所有本地改动均已在生产环境发布或通过真实模型验收。

## 包含内容

| 目录 | 内容 |
| --- | --- |
| 根目录 Python 文件、`flow_models.json` | 站点服务端、权限、积分、队列、模型服务集成、画布与媒体接口 |
| `static/` | 网站页面、脚本、样式、图标与已构建前端文件 |
| `canvas/` | React/TypeScript 画布、对话及公共选择器源码与依赖锁定文件 |
| `agent/` | GPU 接入安装器、硬件检测、缓存、下载、推理和固定版本引擎源码 |
| `deploy/` | Caddy、systemd 和历史部署工具 |
| `tests/` | 平台回归脚本与测试夹具 |
| `fmWorker/` | 配套桌面客户端完整受版本控制源码；以普通文件收录，不依赖 Git 子模块 |
| `FumiaoColab/` | Colab 配套客户端 Swift/Python 源码、构建工具和许可证 |
| `services/muse2api/` | 本地定制的 Muse 服务源码，包含登录与认证改动 |
| `services/flow2api/` | Flow 服务子路径适配源码，包含后续 Cookie 持久化源码覆盖及测试 |

`SOURCE_MANIFEST.json` 记录导出文件哈希及相关上游版本。第三方许可证和 NOTICE 保留在各自目录中。`fmWorker` 的独立上游仓库仍然保留，这里另存一份源码便于完整获取。

## 不包含运行数据

API 密钥、登录会话、Cookie、管理员初始化凭据、支付凭据、SQLite 数据库、团队素材、生成作品、模型权重、虚拟环境、依赖安装目录、桌面应用安装包与历史验收截图不进入仓库。部署时需单独配置凭据和运行数据；源码仓库不能替代数据库与媒体的备份。

保留的 `agent/vendor/runtime/comfy.git.tgz` 是固定版本 ComfyUI 的源码 Git 存档，不是模型权重；`agent/agent.tgz` 是由同目录源码打包的工作节点程序。权重仍按锁定清单从模型源下载。

## 构建入口

- 网站后端：Python 3.12，`requirements.txt`，另需 FFmpeg/ffprobe。
- 画布与对话：`npm ci --prefix canvas`，然后 `npm run build --prefix canvas`。
- GPU 节点包：`bash agent/build.sh`。
- fmWorker：按 `fmWorker/README.md`，使用其 Node/Rust/Python 锁定版本。
- FumiaoColab：在 macOS 上运行 `bash FumiaoColab/build.sh`。
- Muse/Flow 是独立可选服务，分别使用其目录中的 README、Dockerfile 和示例配置；真实账号数据须另行配置。

本机启动网站示例：

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
export FUMIAO_DATA="$PWD/.data"
export FUMIAO_SITE="http://127.0.0.1:18732"
export FUMIAO_MUSE_AUTOSTART=0
.venv/bin/uvicorn server:app --host 127.0.0.1 --port 18732
```

管理员初始化按主 README 的 `bootstrap_admin.py` 流程进行。初始化文件只在本机生成，不应提交。

## 发布状态

`deploy/publish.sh` 是原项目保留的早期覆盖式发布脚本，原 README 已标注它不适用于当前完整功能集。不要把源码上传理解为执行了该脚本。生产发布仍需采用完整模块清单、备份与版本切换流程。

主 README 中指向 `work/`、`交付/` 的历史验收记录属于本地操作资料，未随源码上传。GitHub Actions 在新仓库初始上传时保持关闭，避免源码备份触发桌面安装包构建；工作流源码完整保留，可按需启用。
