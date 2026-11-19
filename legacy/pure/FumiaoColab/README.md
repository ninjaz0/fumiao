# FumiaoColab

原生 macOS MiniMax H3 算力接入应用，面向 Apple Silicon，要求 macOS 13 或更新版本。

## 使用

1. 打开 `dist/FumiaoColab.app`，登录自己的弗淼 AIGC 账号。
2. 点击「绑定」，在浏览器完成 Google 授权，把 Google 页面显示的授权码粘贴回来。
3. 选择 GPU，点击「一键部署并接入弗淼」。默认 G4。首次权重下载约 134 GB，实际耗时取决于实例和网络。
4. 状态显示「已就绪」后，在 nvmes.com 使用 MiniMax H3。客户端无需保留视频创作界面。
5. 默认闲置 30 分钟自动释放。也可选择 15 / 60 分钟或关闭自动释放，或手动点击「释放实例」。自动释放在云端执行，退出 Mac 应用不影响计时。

首次绑定会在本机的应用支持目录准备连接组件，需要已安装 Python 3.12+，与 EasyColab 的本地 Python 桥接方式相同。应用自动寻找 Homebrew 或 python.org 的 Python。无需 Xcode 即可运行已编译版本；目前交付为本机临时签名，尚未进行 Developer ID 公证。

## 账号与额度

- 弗淼会话保存在 macOS 钥匙串，不保存登录密码。
- Google OAuth 令牌、会话及实例记录放在 `~/Library/Application Support/FumiaoColab/`，目录仅当前用户可访问，不修改 EasyColab / colab-cli 的共享账号。
- 实例凭据由已登录的弗淼用户通过现有 `/api/pairs` 创建，服务器决定 owner。云端只收到单实例配对码，不接收弗淼账号密码或登录会话。
- 额度和扣费速率来自 Google 的账号数据，包含该 Google 账号其他运行时的用量。未知值显示「—」。
- 本应用仅释放自身登记的实例，不接管其他笔记本或执行账号级 stop-all。

## 部署方法

沿用 [EasyColab](https://github.com/wy51ai/easycolab) 的 `google-colab-cli` 分配 / Jupyter 上传运行流程，使用一台 GPU 虚拟机。文本编码器与视频 DiT 是同一实例中的两个模型主干，按可用系统内存分为双主干 CPU 热备、编码器 CPU 热备及磁盘卸载三档。采用 DiffSynth BF16、提示词缓存、按余量调度显存与分块解码；缓存指纹已改为整图哈希，避免上游仅比较图片前 512 字节造成碰撞。

DiffSynth 固定到 `fdad57bd94d3fbac8a72c44920dd0a23b719ebb9`，H3 权重固定到 `42ed227ee7df40d41602854ae760620d6eb651fe`。单图任务使用居中裁切后的首帧；多图任务切换 Ref2VA 权重，首次会额外下载这一分支。此实例只上报 BF16 16 / 20 / 32 / 50 步能力，不领取 4 步 Turbo 任务。

云端直接调用弗淼既有心跳、任务领取、参考图、回执和成片接口。视频按平台要求输出 H.264 / 24fps / AAC / 32 kHz 双声道；服务器校验尺寸、帧数、摘要及完整解码。失败部署会尝试释放实例，释放未确认时保留本地恢复记录。安装 / 下载持续两小时未就绪时尝试释放。Drive 缓存按账号授权使用 rclone，缓存失败时可继续从 Hugging Face 下载；缓存完成前结束实例可能需要下次补下载。

## 构建与验证

```sh
bash build.sh
python -m unittest discover -s Tests -p test_bridge.py
../.venv/bin/python Tests/test_platform.py
```

`test_bridge.py` 需要安装 `Resources/requirements.txt`；平台测试使用弗淼项目的现有虚拟环境和 ffmpeg。测试使用独立临时数据，不调用 Google 付费算力。

已验证原生编译、两种界面截图、10 个桥接行为测试，以及真实本地平台 API 的登录、实例归属、账号隔离、心跳、领取、合成测试视频回传、重复回执和 Turbo 排除。

**尚未实测：** 用户 Google OAuth 完整授权、Colab 实际配额分配、模型完整下载 / 加载、GPU 视频生成、Drive 大文件缓存及云端自动释放。需要用户登录后做一次真实部署验收；不能将本地通过视为端到端生产验收。

来源与许可见 `NOTICE` 和 `Resources/LICENSE-EasyColab.txt`。`--preview` 为明确标注的界面示例模式，不连接账号、不部署实例。
