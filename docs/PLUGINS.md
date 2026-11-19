# 插件开发

## 工作台插件包

管理员在「设置 → 插件」导入一个 `.fmplugin.json` 文件。确认页列出版本、模型、设置字段和新增能力。导入后默认关闭。服务地址填写从 API 和任务进程可访问的根地址。测试连接只读取健康状态或模型列表。勾选模型、设置价格并打开开关后，创作者就能在原来的位置选择模型。价格为 0 表示免费，留空表示该档位尚未定价。

同一插件可以添加多个服务。第一个服务默认承接任务，管理员可以按模型切换。两个插件要提供同一个公开模型时，以相同的稳定模型 ID 发布，并由新增插件通过包顶层的 `equivalentModels` 声明这些 ID。平台核对模型种类、输入和计价规则，管理员手动选择全站默认服务。独立模型用不同 ID，可以有相同显示名。已受理的任务保留插件版本、服务、配置和价格。

首批独立文件见 [Flow](../plugins/flow/flow.fmplugin.json)、[Muse](../plugins/muse/muse.fmplugin.json)、[GPU 节点](../plugins/gpu/gpu.fmplugin.json) 和 [兼容对话](../plugins/compatible-chat/compatible-chat.fmplugin.json)。GPU 包附带配对页面、执行协议和机器安装文件。安装后管理员即可配对。关闭停止接收新的生成请求，移除会等待已受理的任务结算，再清理连接和密钥。每台机器的程序由管理员单独更新。

在「兼容对话 → 设置」中选择提供方，展开「更多设置」填写 API 密钥。使用自建兼容服务时填写 API 根地址，留空会使用提供方默认地址。保存并测试连接，再打开插件开关。每个提供方可建一个连接。`deepseek` 提供 DeepSeek Flash，`openai` 提供 GPT-4.1。创作者在「对话」中发送消息，生成定价按每条完整回复设置积分。

对话包版本为 `1.2.1`，沿用 `compatible-chat@1.2.0` 适配器。平台版本须包含该适配器的发行摘要。已由旧版工作台登记的同版本连接在重启时自动接入，保留原配置与启用状态。

### 发布与更新

文件顶层包含 `format: 1`、`id`、`label`、`version` 和 `adapterVersion`。版本采用三个非负整数，以点分隔。直接接入服务的通用包包含 `manifest` 和 `program`。清单按下文 v3 契约声明模型、参数和价格。程序是一个 JavaScript 对象表达式，提供 `request({model,kind,input,remoteId})` 和 `result({raw,model,kind,remoteId})`。前者返回同源的 `{path,body}`，省略 body 为 GET；后者把服务响应映射成下文的任务回执。程序在受时间和内存限制的 QuickJS 中处理 JSON，平台负责携带密钥发请求。已有独立协议服务可在同一个包中用 `remote: {endpoint,manifest}` 作为接入方式。

首批发行包还携带由平台按摘要校验的原生适配器。GPU 的节点协议、Flow 的流处理、Muse 的异步任务恢复和对话的流式回复使用这项能力。已核验的原生代码运行在宿主进程，新原生二进制需要平台发行版信任其摘要；普通映射程序、节点设置内容可随插件独立更新。运行 `pnpm plugins:pack` 从源码生成各插件的单文件包、校验值和更新清单。

`updateUrl` 可以指向自建 HTTP(S) 服务器上的清单，也可以指向以 `.git` 结尾的 HTTP(S) Git 仓库。Git 读取默认分支根目录的 `update.json`，包和清单来自同一次提交。HTTP 包从同源地址读取。以下示例中的摘要须替换为发布文件原始字节的 SHA-256。

```json
{"id":"demo","version":"1.1.0","notes":"增加高清档位","package":"demo.fmplugin.json","sha256":"<64 位小写十六进制摘要>"}
```

平台每天检查一次。管理员也可以点击「检查更新」，检查记录显示在插件设置中。检测到新版后，卡片显示更新按钮，确认时再次校验下载内容。更新前使用已有服务配置做只读检查。新增模型默认关闭，有定价覆盖的档位沿用原价，可在设置中回到上一版本。管理员可覆盖作者的更新地址并填写独立的只读凭据。Git 服务器使用 Bearer 时填令牌，要求 HTTP Basic 时填 `用户名:只读令牌`。发布到私服时同时上传两个文件；离线环境可手动导入完整包。

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

插件页使用上文的单文件导入流程。下表列出独立 HTTP 服务的编程接口。插件服务地址须能从 API 和 worker 容器访问。自动化管理使用当前工作台的原协议管理员会话调用下表接口。请求以 JSON 提交。浏览器的 `Origin` 使用工作台地址。

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

## 按模型注册 Studio 参数

原生适配器通过 `modelForm(model)` 注册比例、清晰度、时长、参考模式等控件和默认值。平台按插件 ID 和版本保存这份声明，Studio 通过 `/api/state` 的 `model_forms[模型 ID]` 读取当前生效的版本。画布使用已注册画布提交能力的模型。已有的 v2 远程连接会在启动时补齐表单。

新远程插件可声明 `originalSubmission: {"version":3}`。每个模型的 `inputSchema` 同时定义可编辑参数和服务端验证规则。以下视频模型允许 480P 搭配 5 秒、1080P 搭配 8 秒，并接受自定义的镜头运动参数。

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["quality", "seconds", "motion"],
  "properties": {
    "quality": {"type":"integer","title":"清晰度","enum":[480,1080],"default":480},
    "seconds": {"type":"integer","title":"时长（秒）","enum":[5,8],"default":5},
    "motion": {"type":"string","title":"镜头运动","enum":["固定","跟随"],"default":"固定"}
  },
  "anyOf": [
    {"type":"object","required":["quality","seconds"],"properties":{"quality":{"const":480},"seconds":{"const":5}}},
    {"type":"object","required":["quality","seconds"],"properties":{"quality":{"const":1080},"seconds":{"const":8}}}
  ]
}
```

- 字段支持字符串、整数、数字和布尔值。`enum`、`default`、数值上下限和字符串长度限制分别控制选项、初值和输入范围。`anyOf` 可声明枚举字段的合法组合，用户选择一个参数时，其余选择随之调整。
- 每个 `studio.prices[]` 档位仍声明 `tier`、`label`、`amount` 和 `match`。上例的两条组合可分别直接作为两个档位的 `match`。条件支持 `const` 和 `enum`，参与匹配的字段须全部列入 `required`；统一价格使用 `{"type":"object"}`。每次生成必须匹配唯一的已定价档位。
- Studio 向生成接口提交 `params` 对象，远程服务在 `input.params` 中收到校验后的值。图片、视频可继续用 `x-references` 约束图片素材数量。提示词、素材授权及工作区权限沿用现有协议。
- 改动已注册的字段、默认值或组合需要发布新插件版本并激活模型目录。

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
