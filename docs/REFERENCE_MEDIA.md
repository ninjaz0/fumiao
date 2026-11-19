# H3 参考素材迁移

原协议 `POST /api/h3/references?kind=video|audio` 已由 NestJS、PostgreSQL 和私有对象存储实现。转码规则来自 GPU 插件 `1.4.0` 的版本化 `referenceImports` 能力，核心负责会话、工作区权限、容量、存储和公开编号，插件不接触数据库或积分。

这是完整 H3 生成迁移的一个前置步骤。GPU `1.4.0` 只提供上传能力，生成 schema 仍为旧版 4 图限制；后续 `1.5.0` 已增加首尾帧、9 图 / 12 个混合参考冻结和 worker 消费，详见 [原生 GPU 迁移](NATIVE_GPU.md)。默认 `/studio` 仍连接原版兼容后端，完整原生成 HTTP、状态和相应 React 控制仍待迁移。

## 插件与运行

- `referenceImports` 项声明 `version: 1`、能力 ID、允许的 `kinds` 和 `maxBytes`；本地适配器实现 `importReference(inputPath, outputPath, kind, signal)`。它只读取本次临时输入，返回输出格式、尺寸、字节数、时长、帧率和声音信息；客户端不能自行声明这些信息。
- 上传入口根据已激活的目录版本查找 `h3` 能力。安装 GPU `1.4.0` 不自动激活；未激活、多个插件同时占用能力或缺少本地适配器时拒绝处理。远程插件 manifest 不能注册本地文件转换能力。原版本及已接受任务的快照保持不变。
- API 容器需安装 FFmpeg 和 ffprobe；现有 Dockerfile 已安装。全部转换在子进程执行，2 个并发、最多 32 个等待任务，队列满返回 503。此上限按 API 进程计算；增加副本时要同时安排 CPU 和临时盘容量。
- 保留原输入上限 96 MiB、输出上限 64 MiB、时长校验、格式及协议白名单。视频统一 H.264、24 fps、偶数尺寸、最长边 1280；音频转为 32 kHz 双声道 PCM WAV，视频附带声音转 AAC。移除源元数据和章节。
- 探测 20 秒、转码 90 秒超时；进程输出最多 1 MiB。断开客户端或超时会终止进程，等待其退出后才释放并发槽和临时目录，失败信息不包含 FFmpeg 诊断或私有路径。
- 上传和私有对象保存均流式处理。落盘对象创建时即为 0600；S3 使用带长度及取消信号的流。数据库事务再次检查工作区，并依靠容量触发器处理竞争；失败删除部分对象，不留下素材或参考信息行。公开 32 位媒体编号和内部 UUID 仍分离。

## 数据迁移

`015_reference_media.sql` 新增 `asset_reference_media`。新上传记录转换插件的 ID 与版本；历史导入保留真实 `seconds`、`fps`、`has_audio` 和 `name`，插件来源为空，不给历史文件伪造转换版本。素材删除级联清理信息。

`scripts/export-legacy.py` 现在显式导出 `h3_reference_media` 的这些字段。导入在复制文件前检查对应素材、数值、名称和重复记录，再把旧媒体编号映射至内部 UUID。媒体字节和公开 URL 不变。

旧导出文件没有包含这些字段的仍可导入，但无法从文件清单推断原参考信息。之前完成导入的实例也不会被再次导入覆盖；完整切换演练应从固定源实例重新导出，导入全新的隔离库。不得在用户已使用的新库上重导或补造时长。没有参考信息的历史视频/音频不能直接进入原生 H3 生成链路。

## 验证

准备固定 Python 环境以及本机 FFmpeg，运行：

```sh
pnpm test
pnpm test:references
pnpm test:media
pnpm build
```

`pnpm test:references` 调用未修改的 `legacy/pure/h3_inputs.py`，在相同 FFmpeg 下比较 32 个视频/音频转换场景的完整字节、元数据和错误。包含 WAV、MP3、FLAC、Ogg、AAC、H.264、VP9、奇数尺寸、缩放、无声音、错误类型、上下限时长及损坏文件；另有 4,028 个 Python 浮点舍入对照。跨 FFmpeg 版本的编码字节不作一致性承诺，参考与待测进程必须使用同一套二进制。

`pnpm test:media` 现有 175 项真实 HTTP 对照，包含元数据导出/导入、原错误体、查询验证顺序、文件名解码、完整媒体字节与 Range、工作区拒绝、容量不足、私有读取及删除，以及后续新增的排队任务撤回与单条任务删除。合成数据保存在临时原数据库和随机 PostgreSQL schema，测试后清理；未设置 `TEST_DATABASE_URL` 时使用 PGlite。

平台测试覆盖转换并发/取消、进程终止、部分输出删除、插件能力注册及显式激活、私有文件权限、S3 流、中断上传、配额竞争及错误导入。报告分别保存于 `.runtime-advanced/reference-parity/report.json` 和 `.runtime-advanced/media-parity/report.json`。未调用真实模型提供方或支付接口，也未修改固定原站文件。
