# 原图片转换迁移验收

默认 `/studio` 仍使用完整原服务链路。新上传接口位于显式选择的 `API_PROTOCOL=original` Nest 应用，不依赖 Python 转换服务。本页验收通过不代表完整工作台迁移完成。

实现保留常见静态 JPEG/PNG/WebP 原字节，其他格式转换为 JPEG 或带透明度的 PNG；动图取首帧，HEIF 取指定主图。头像校正方向后居中裁剪为 256×256 WebP。Lanczos 采样保留 Pillow 的系数精度、两次采样次序、透明度预乘及整数舍入，算法来源与许可保存在 `packages/image-import/PILLOW-LICENSE`。

## 构建和运行

本机先准备 Node 24、CMake 3.20+、Ninja、C++ 编译器及 FFmpeg，再运行 `pnpm images:prepare`。Docker 自动执行这个构建。现有 CI 通过 Docker 构建验证镜像；本轮新增的独立图片对照工作流配置尚未同步，GitHub 当前 OAuth 授权缺少 `workflow` scope。本机已执行下述严格对照。源码 URL、版本及 SHA-256 固定在 `packages/image-import/native/sources.json`；下载校验失败会中止，不使用系统里其他版本的 HEIF 解码库。构建产物在被 Git 忽略的 `packages/image-import/native/build`，无需提交本机二进制文件。

HEIF 使用动态链接的 libheif 1.23.6 / libde265 1.1.3，独立进程输出有长度上限的 RGB/RGBA 数据。编译仅启用 HEVC 解码，运行不加载外部插件。库的许可文本与对应版本源码压缩包随构建产物一起放在 `share/`，可按仓库构建脚本重新构建或替换共享库。AVIF 使用固定 `@phenomen/libavif-wasm@1.4.203`（libavif 1.4.2 / dav1d 1.5.4）；容器方向由 libheif 读取，按顺序应用旋转和镜像，再进行色彩转换。PNG/JPEG/WebP 等由 sharp 0.34.5 处理，BMP 使用 FFmpeg。

工作线程默认并发为 1，可用 `IMAGE_CONCURRENCY` 设置 1–8；待处理队列最多 32 项，单项超时 120 秒。外部解码在工作线程内同步等待，单次最多 60 秒，超时使用 SIGKILL；不会阻塞 API 主线程。取消后先等待工作线程及外部解码退出，再释放槽位和暂存文件，因此正在外部解码的取消可能等待其结束或超时。测试验证取消时不会提前删除仍被解码器使用的文件。每项完成后释放线程的原生/WASM 解码内存；BMP 输入不允许加载网络协议。

## 严格对照结果

运行 `pnpm test:images`，需要已准备的原版 Python 参考环境。Python 仅用于生成测试期望结果。每次测试使用新临时目录，不读写用户数据，不调用模型提供方。报告保存在 `.runtime-advanced/image-parity/report.json`；任何错误契约、原字节或解码像素差异都会让命令返回失败，不设置像素容差。

当前 58 个合成文件、116 个场景全部通过：JPEG、PNG、WebP、GIF、TIFF、BMP、HEIF、AVIF，覆盖透明度、CMYK、16 位灰度、PNG/HEIF/AVIF 的 EXIF 2–8 方向、横/竖裁剪、动图、单帧 APNG、带默认图 APNG、HEIF 主图和 4:4:4 色度、奇/偶数尺寸、CRC/截断及不支持格式。格式、方向、首帧标志、错误契约和输出解码像素完全一致；原样保存的静态图片另要求文件字节完全一致。

转换后文件包含色彩配置，编码字节并非静态基线，大小字段匹配实际输出文件。此测试尚不能代替尺寸极限、更多 ICC/HDR/文件变体及工作台上传交互的完整验收。参考环境为 Pillow 13.0.0、pillow-heif 1.8.1 / libheif 1.23.6、libavif 1.4.2；没有修改不可变原实现或样本期望来消除差异。
