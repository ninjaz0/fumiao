# GPU 插件

GPU 推理继续使用 Python / CUDA / ROCm 等原生运行环境，主平台 API、业务与队列均为 TypeScript。推理代码和驱动不装入 API 镜像。

## 接入

1. 在管理页创建并启用 GPU 连接，为 H3 / Breeze 模型定价。
2. 点击“接入 GPU”生成 30 分钟有效的单次接入码。
3. GPU 机器需要 Python 3.12+。设置 `FUMIAO_PAIR_CODE` 环境变量，并运行执行端。

```sh
python3 plugins/gpu/worker/worker.py \
  --url https://your-platform.example \
  --state /srv/fumiao-gpu \
  --name gpu-01 \
  --models 'MiniMax H3' \
  --renderer '["python3","/absolute/path/plugins/gpu/worker/render-local.py","{jobdir}"]'
```

使用 `1.3.0` 及以上队列能力时，另加 `--capabilities /path/to/verified-capabilities.json`，声明该机器实际支持的模型、工作流和采样步数。原生 H3 要求 `h3-v6-native-inputs-turbo4`；文件结构见 [能力声明](../../docs/NATIVE_GPU.md#激活与节点声明)。未声明就绪能力的节点不会领取这些版本的任务。

`render-local.py` 连接已经完成模型安装和推理服务配置的运行时。设置 `FUMIAO_GPU_RUNTIME=/absolute/path/to/agent`，其中需有 `render.py`、`breeze_adapter.py`、`engine/` 及固定模型资产。可以沿用旧节点的已安装运行时；普通配对使用 `plugins/gpu/distribution/` 的固定安装包，模型权重需另行配置。视频进程的 Python 可通过 `H3_PYTHON` 指定。

Breeze 运行时需要其既有隔离环境和固定资产。此桥接器不负责自动下载数十 GB 模型、安装驱动或恢复桌面客户端的安装界面。

语音节点将 `--models` 改为 `breeze-tts-2`。推荐按模型分配执行端；此版本不负责多模型自动卸载与显存调度。

首次接入后凭据保存为工作目录下的 `node.json`，权限 0600。不要提交、分享或复制给其他节点。撤销节点后该凭据立即失效。执行端当前面向 Linux/macOS；Windows 可通过 WSL2 运行。

## 自定义 GPU 模型运行器

`--renderer` 接受 JSON 格式 argv 数组，替换 `{jobdir}`，不经过 shell。运行器从以下文件读取输入：

- `request.json`：任务 ID、模型、提示词、参数和引用 ID。
- `input-0`、`input-1` 等：按引用顺序下载的私有素材。

成功后，在任务目录写入 `result.json`：

```json
{"path":"/absolute/path/to/job-directory/output.mp4"}
```

`1.5.0` H3 运行器还需在 `result.json` 的 `report` 中返回实际验证的 `sampling_steps`、`fast_mode`，存在原生输入时必须带 `h3_input_fingerprint`。内置桥接器读取原运行时的 `verified.json` 完成这一转换；worker 计算文件摘要并采集实际计时。临时回传失败使用保存的结果重试，不重新渲染；永久拒绝会停止心跳并保留任务供核对。

结果必须位于任务目录内。执行器本地上限为 128 MiB；插件 `1.5.0` 的服务端成片上限为 64 MiB，并严格验证原生输入指纹、采样报告、摘要、编码、尺寸和完整解码，再完成任务和积分结算。运行器退出异常或节点断线时保留执行记录，平台转为待核对，避免盲目重复生成。

插件 `1.5.0` 与当前桥接器覆盖 H3 文生视频、普通参考图、首尾帧、视频/音频原生参考及 Breeze 文生语音。节点能力与回执要求见 [GPU 节点与生成参数](../../docs/NATIVE_GPU.md)。
