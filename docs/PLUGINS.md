# 插件开发

## 边界

业务核心负责登录、租户权限、素材授权、积分、任务状态和持久化。提供方插件负责协议转换、提交、查询与产物描述。插件不能直接修改积分或读取其他工作区的数据。

内置适配器位于 `plugins/*/src/index.ts`。GPU 使用 `mode: pull`，由执行端主动领取任务；节点网关按连接中固定的插件版本校验型号，领取响应携带 `pluginId` / `pluginVersion`。远程插件使用 `mode: request`，可以用任意语言实现独立服务。不要将第三方代码动态加载进 API 进程。

## Manifest

完整类型见 `packages/plugin-sdk/src/index.ts`，可运行 manifest 见 `plugins/example-remote/manifest.json`。

- `id`：稳定的小写标识。
- `version`：三段版本号；同一版本的 manifest 和 endpoint 不可修改。
- `contractVersion`：当前为 `1`。
- `configSchema`：连接实例的 JSON Schema。密钥字段标记 `writeOnly: true`；加密存储后不会回传界面。
- `models`：模型 ID、标签、类型（image/video/audio/chat）、参数 JSON Schema。
- `inputSchema["x-references"]`：可选 `{ "min": 0, "max": 4, "types": ["image"] }`。在冻结积分前验证素材数目和类型。

完整能力和校验规则见 [Plugin SDK](../packages/plugin-sdk/src/index.ts)。

## HTTP 协议

服务端实现：

| 路径 | 方法 | 用途 |
|---|---|---|
| `/health` | GET | 成功返回 2xx |
| `/submit` | POST | 执行新请求 |
| `/inspect` | POST | 查询异步任务；同步插件无需使用 |

请求包含 `jobId`、`idempotencyKey`、`model`、`kind`、`input`、`config`。`input` 有提示词、参数、已经过权限校验的参考素材（data URL）。`inspect` 还带 `remoteId`。平台在请求头发送 `Authorization: Bearer <连接 apiKey>`。连接配置仅发往管理员安装的可信插件服务；不应把插件 endpoint 指向不受信任的地址。

响应必须是以下之一：

```json
{"state":"pending","remoteId":"provider-task-id"}
```

```json
{"state":"completed","artifacts":[{"url":"https://media.example/result.mp4"}],"usage":{}}
```

```json
{"state":"completed","artifacts":[],"text":"对话结果"}
```

```json
{"state":"failed","error":"上游已确认失败"}
```

`pending` 只能在上游确定已接收后返回。重复提交同一 `idempotencyKey` 应返回同一结果。网络中断不代表上游未执行：平台不会自动重新提交没有确认回执的任务。

产物地址限于连接 `baseUrl` 的 origin、显式 `artifactOrigins`，以及 Flow 的已知 Google 媒体域。远程插件配置 schema 应显式声明 `artifactOrigins`。不跟随媒体重定向。平台会下载并校验真实媒体，之后才结算积分。也支持有限大小的 PNG/JPEG/WebP/MP4/WAV/MP3 data URL；大文件优先使用 HTTPS 地址。

## 运行示例

设置一个自选的 `PLUGIN_KEY` 环境变量：

```sh
pnpm exec tsx plugins/example-remote/server.ts
```

在管理页安装 `plugins/example-remote/manifest.json`，endpoint 填 `http://127.0.0.1:4100`；连接的 `apiKey` 必须与 `PLUGIN_KEY` 相同。若平台在 Docker 中，使用容器可达的地址。开放 echo 模型后可执行一次插件回显任务。这个示例不调用 AI、不产生外部费用。

### 默认工作台运行示例

在本机测试工作台旁启动图片示例。它返回固定 PNG。

```sh
export PLUGIN_KEY=local-demo-key
PORT=4100 pnpm exec tsx plugins/example-studio/server.ts
```

管理员也可以在普通 `/studio` 的「设置 → 插件」中安装清单、创建连接、测试与启用连接。插件服务地址须能从 API 和 worker 容器访问。自动化管理使用当前工作台的原协议管理员会话调用下表接口。请求以 JSON 提交。浏览器的 `Origin` 使用工作台地址。

| 请求 | JSON |
|---|---|
| `POST /api/admin/plugins` | `{"manifest": <plugins/example-studio/manifest.json 的内容>, "endpoint": "http://127.0.0.1:4100"}` |
| `POST /api/admin/connections` | `{"name":"本地示例","pluginId":"local-studio-demo","version":"1.0.0","config":{"apiKey":"local-demo-key"}}` |
| `POST /api/admin/connections/{id}/health` | 无请求体。使用上一步返回的 `id`。 |
| `PUT /api/admin/connections/{id}` | `{"revision":1,"enabled":true,"concurrency":1}` |

进入 `/studio`，选择「图片生成」和「本地示例图片」。可使用原比例、分辨率、画质和参考图控件。输入提示词后生成，结果出现在图片历史，积分记录显示冻结和扣除。默认示例的 1K 标准档为 7 积分。

新插件在 manifest 中声明 `mode: "request"` 和 `originalSubmission: {"version":2}`。每个模型声明 `studio` 的排序、基础描述（`kind`、`label`、可选 `hidden`）及档位，`inputSchema` 校验下列参数。

| 创作类型 | HTTP `input.params` | Studio 档位 |
|---|---|---|
| 图片 | `ratio`、`resolution`（1K/2K）、`image_quality`（low/medium/high） | `<resolution>\|<image_quality>` |
| 视频 | `ratio`、`quality`（480/768）、`seconds`（5/10/15）、`seed`（整数或 null） | `<quality>\|<seconds>` |
| 语音 | `instruction`、`seed`（整数或 null） | `standard` |

图片和视频的 `match` 用对象 schema 的 `required` 和 `properties.const` 匹配表中档位里的两个字段，字段顺序与表中一致。语音使用 `{"type":"object"}`。省略档位或将价格设为 null 可关闭该组合。图片和视频可声明 `x-references` 的 `min`、`max`（0–9）和 `types: ["image"]`，默认接受 0–9 张图片。提示词和已授权的素材仍通过 `input.prompt` 和 `input.references` 传递。

初装注册目录，连接启用后可提交。升级仍通过下节的显式目录激活。服务端在接受请求时冻结版本、配置、引用及价格。排队任务依然遵守连接启用状态、并发限制和当前工作区模型权限。同一用户、插件和创作类型的 UID 在同一空间重试会返回原任务，在其他空间重试会被拒绝。远程工作台契约覆盖通用图片、视频和语音表单，专属模型控件、画布提交、时长预测和本地适配器能力各有独立契约。

运行 `pnpm build && pnpm test:studio:remote-provider` 可用临时 PostgreSQL、Redis、私有存储和回环提供方复现。需要 Chromium、`initdb`、`postgres`、`redis-server`、`ffmpeg` 和 `ffprobe`。PostgreSQL 和 Redis 可分别用 `PG_BINDIR` 和 `REDIS_SERVER` 指定。

## 升级与停用

发布新版本 manifest，再调用管理员接口：

```text
POST /api/admin/connections/:id/upgrade
{ "revision": 2, "version": "2.0.0", "config": { ... } }
```

升级后连接关闭，重新核验并启用；未绑定目录的模型仍需单独开放。激活新的目录版本时，在上述请求中增加 `"activateCatalog": true`。目录激活会推进策略/价格修订，其他连接须升级到相同目录版本后才能接受新任务；现有隐藏覆盖和管理员价格保留。已经接受的任务保留原插件版本、模型、凭据与价格快照；旧版本必须保持可用，直到任务全部结算。插件不能通过覆盖版本改变已接受任务的行为。

`POST /api/admin/jobs/:id/resolve` 用于核对 `uncertain` 任务，可填写上游编号恢复查询，或在确认后结束任务并释放积分。所有核对都记录理由和操作者。

取消排队任务会立即释放积分。运行中的外部任务只有在提供方确认取消后才能释放；不支持取消的提供方会继续等待最终结果。GPU 执行端在心跳中接收取消请求。

支付适配器是独立的 `PaymentAdapter` 接口，见 `plugins/payments/src/index.ts`。当前内置 ZPay 和 EPusdt，尚不支持在管理页动态安装第三方支付插件。
