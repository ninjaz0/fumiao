# fmWorker

弗淼的桌面资源客户端。连接本地 Breeze、当前 Chrome 用户中的 Google Flow，或 Colab GPU；创作、排队和作品管理继续在弗淼网页完成。

当前版本：**0.4.0 开发验证版**。Windows 11 x64 与 Apple 芯片 macOS 13+ 为目标平台。本仓库保留多实例管理、账号权益检测和 H3 部署，不包含网站 Notebook 功能。Colab H3／Breeze 真机生成与正式签名等验收范围见 [VALIDATION.md](VALIDATION.md)。

## 使用方式

1. 使用现有弗淼账号登录，连接 Google 账号。
2. 在 Flow 页面按向导安装“fmWorker 连接助手”，沿用已有 Chrome 用户和登录状态。程序会自动检测已经打开的 Flow 页面，并核对账号。
3. 选择开始或暂停贡献。贡献时段、每日／每月任务数、CU 预算功能已移除。
4. 关闭窗口后驻留托盘；单击托盘图标直接打开窗口。退出软件会等待本地和 Flow 任务结束，Colab 实例继续运行，继续执行模型任务。

启动时先显示连接中，等待超过 30 秒才显示连接超时；只有检测到网络断开时显示无网络。重试会重新计时。

Mac 使用 Flow 和 Colab，本地 Breeze 仅针对 Windows NVIDIA。Colab 登录后先读取权益，必须选择实例类型才能“创建实例”；这只创建空实例。“一键部署 H3”始终另建 G4，其他实例保持运行。平台不再设置空闲释放和最长运行时间，释放需逐台明确操作；Google 自身限制仍然适用。


## Chrome 连接助手

客户端提供“准备扩展、打开扩展管理、显示文件夹、复制路径、自动检测”的向导。当前扩展未上架 Chrome Web Store，开发版需要本地加载。普通用户正式分发应先上架商店，保留 Chrome 的安装／启用确认。

- 使用当前 Chrome 用户；不复制用户资料，不开启远程调试，不读取浏览记录或 Chrome 保存的密码。
- 站点权限为 `flow.google.com`、`labs.google`，用于 Flow 页面交互和 Flow 所需的 Google 登录 Cookie。
- 扩展通过 Chrome Native Messaging 与原生 Rust 程序通信。Chrome 启动的这条通道不加载 Python。
- 本机后台使用随机密钥保护的回环接口；请求绑定到发起请求的 Chrome 用户连接，过期请求不重放。
- 长期凭据保存在系统凭据库。Colab 只收到节点凭据和经过范围检查的短期 Drive 授权。

## 构建

运行器源码快照位于 `vendor/platform/`，克隆本仓库后不依赖相邻的平台项目。模型权重不在仓库中。

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm ci
.venv/bin/python scripts/build_bridge.py
npm run tauri build
```

Windows 使用 `.venv\Scripts\python.exe`。Rust 版本在 `rust-toolchain.toml` 固定。Mac 构建脚本要求 Apple 芯片。正式分发前须配置开发者签名与公证；当前 Mac 构建采用开发自签名，Windows 构建未签名。

与完整弗淼平台联调时，可设置 `FMWORKER_PLATFORM_SOURCE` 指向平台源码，使用其中的执行器和模型目录。默认构建从本仓库快照生成运行包，并校验固定版本的 Flow2API 源码哈希。

## 检查与开发

```sh
npm run typecheck
npm test
node --test tests/chrome-extension.test.mjs
.venv/bin/python scripts/prepare_assets.py
.venv/bin/python -m pytest tests -q
cargo test --manifest-path src-tauri/Cargo.toml --release
```

平台结算集成测试需要完整平台源码；独立克隆时该模块会明确跳过。通过 `FMWORKER_PLATFORM_SOURCE` 指定平台后可运行全部检查。

`npm run demo` 启动带明确标记的模拟界面，`npm run build:demo` 单独输出演示构建。正式构建不包含模拟账号或任务。

## 代码结构

- `src/`：React 界面与真实后台协议。
- `src-tauri/`：原生窗口、托盘、退出排空、Chrome 原生消息通道。
- `runtime/fmworker/`：平台、凭据库、Google、Flow、Colab、Breeze 与本机连接器。
- `resources/chrome-extension/`：Chrome 连接助手。
- `resources/`：云端监督、缓存、固定依赖与上游版本清单。
- `vendor/platform/`：与主平台一致的执行器和模型定义源码快照。
- `platform-integration/`：资源池与 API 接入模块，不含整个网站或数据库。
- `tests/`：客户端、扩展和平台集成检查。

前端由 Antigravity 中的 Claude Opus 5.5 编写，Codex 完成软件整合与后续修复。界面规则见 [DESIGN.md](DESIGN.md)，产品范围见 [PRODUCT.md](PRODUCT.md)，第三方授权见 [NOTICE](NOTICE)。
