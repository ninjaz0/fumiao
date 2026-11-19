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
- `timing`：可选版本化计时策略，由本地插件的纯函数 `timingFeatures` 配合使用。GPU / Muse / Flow / 图片新增 `1.2.0`，安装不自动激活。执行器的可选 `reportTiming` 回调按当前租约校验；远程 HTTP 特征协议尚未完成，见 [计时迁移](TIMING_MIGRATION.md)。
- `queue`：`1.3.0` 本地队列能力，声明策略及可兼容的计时版本。`queuePlan` 仅计算快照，`claimEligible` 检查 pull 节点资格，`queueHealth` 执行有限只读探测，`requestCapacity` 限制请求派发。核心不维护提供方名称/型号条件；远程 HTTP 队列协议、原任务/状态接口和完整并行 GPU 资源协议尚未完成，见 [队列迁移](QUEUE_MIGRATION.md)。
- `referenceImports`：GPU `1.4.0` 新增的本地参考素材转换能力，声明能力 ID、类型和上传上限；`importReference` 仅处理私有临时文件。需要显式激活目录版本，不允许远程 manifest 注册。核心统一处理权限、容量与持久化，见 [参考素材迁移](REFERENCE_MEDIA.md)。
- `timing.providerClock`：Muse `1.4.0` 的绝对时间能力。`reportProviderClock` 接收有限时间/阶段字段，平台按当前租约更新原执行记录；不包含提供方原响应，不传给远程 HTTP 插件。和 worker 单调区间 `reportTiming` 分开，详见 [提供方时间](TIMING_MIGRATION.md#提供方绝对时间)。
- `inputPreparation`：GPU `1.5.0` 的输入冻结能力；`referenceIds` 选择待授权素材，`prepareInput` 仅接收授权元数据并返回参数和有序引用，平台用 `preparedSchema` 验证结果。客户端不能直接填写冻结清单。
- `artifactValidation`：GPU `1.5.0` 的本地 pull 成片验收能力；`validateArtifact` 校验媒体和执行回执，返回 `{metadata, timing?}`。核心按当前租约完成私有保存、计时和一次结算。两项能力均要求已安装的本地适配器，见 [原生 GPU 迁移](NATIVE_GPU.md)。
- `originalSubmission: { "version": 1 }`：内置原生成请求适配能力。插件声明命名空间、验证顺序、引用角色、准入上限并冻结原参数视图。见 [原生成提交契约](ORIGINAL_GENERATION.md)。
- `originalSubmission: { "version": 2 }`：默认工作台的远程 request 提交契约。服务端用固定适配器从现有创作控件读取参数，再调用通用 HTTP 插件协议。见 [默认工作台运行示例](#默认工作台运行示例)。
- `originalEstimate`：GPU `1.7.0`、Muse `1.6.0`、Flow / 图片 `1.5.0` 的原估时查询能力；只读取授权素材并返回待估任务参数，GPU 另声明估时节点资格。核心在只读一致快照中计算，不创建任务或冻结积分。仅支持本地适配器，见 [原估时查询](ORIGINAL_ESTIMATES.md)。
- `originalState`：GPU `1.8.0`、Muse `1.7.0`、Flow / 图片 `1.6.0` 的原公开状态能力，声明配置字段、队列分组、任务投影及可选的产物角色、图片开关和 GPU 中断重试策略。公开配置不接收密钥，旧任务行为不自动升级；仅支持本地适配器，见 [原状态聚合接口](ORIGINAL_STATE.md)。
- `artifactDownload`：Muse `1.8.0`、Flow `1.7.0` 的本地产物下载能力。插件按任务冻结配置转换原公开地址、配置鉴权、限制下载并报告可恢复或终态错误；核心继续处理媒体校验、存储及结算。远程 manifest 不接受这项能力，见 [提供方成品下载](PROVIDER_DOWNLOADS.md)。
- `artifactValidation: {version: 2}`：Muse `1.9.0`、Flow `1.8.0` 的本地 request 成品验收。`validateArtifact` 返回原公开媒体元数据，输入文件保持原字节；`ArtifactValidationError` 的 503 表示本地校验资源暂不可用，保留回执重试，其余验收错误进入一次失败结算。GPU 的 version 1 仍仅用于 pull，远程插件不能注册，两种版本不能混用，见 [提供方成品验收](PROVIDER_MEDIA.md)。
- `requestLifecycle`：Muse `1.10.0` 的本地请求生命周期。插件声明原维护规则和文案，通过受租约保护的 `reportProviderNote` 更新说明、`RequestLifecycleError` 请求持久化退避/继续轮询/终态失败；平台统一恢复和结算。未知提交不重发，旧版本不自动继承；远程注册拒绝，见 [Muse 请求生命周期](MUSE_LIFECYCLE.md)。
- `requestLifecycle: {version: 2}`：Flow `1.9.0` 增加串行 FIFO、参考角色、生成进度/健康、原取消计时、恢复保存优先及分阶段错误策略。SSE 解析和安全文案仍由插件处理，核心不增加 Flow 名称分支。Muse version 1 保持不变，见 [Flow 流式生成与恢复](FLOW_LIFECYCLE.md)。
- `requestLifecycle: {version: 3}`：图片 `1.7.0` 增加配置准入、同事务参考快照、服务可用时取消、不可恢复同步执行与总时限策略；不可恢复任务要求单个产物与终态/积分原子提交。PNG / Base64 / HTTP 错误仍由插件负责，旧能力版本不变。可选 `providerResponse` version 1 保留原请求编号和 usage 文本，见 [图片生成执行与恢复](IMAGES_LIFECYCLE.md)。
- `originalImageSettings`：图片 `1.8.0` 声明旧管理命名空间、默认/联动模型和只读探测。核心负责原校验、权限及策略事务，插件负责探测请求和错误；版本需显式激活，远程注册拒绝，见 [原图片设置与连接探测](IMAGE_SETTINGS.md)。

- `chat`：对话 `1.2.0` 的本地流式提供方能力；声明服务/模型/默认配置和凭据回退，提供流式、标题及探测方法。连接模型按服务绑定，安装与激活分开。原配置接口已适配；独立会话执行/计费与完整原会话历史导入已隔离验证，HTTP/SSE 与画布写回尚待接入；见 [原对话提供方与配置](CHAT_PROVIDERS.md)。
- `canvas: {version: 1, models: [...]}`：Muse `1.11.0`、Flow `1.10.0`、GPU / 图片 `1.9.0` 声明画布保存时的模型类型、空模型默认规则、画幅/时长与原错误、模板优先顺序。仅使用显式激活的目录版本，安装不改变旧目录/连接/任务；模型必须属于该插件且有 `studio` 元数据。同类默认规则歧义时拒绝使用。该能力是声明数据，外部 request 插件也可注册，无需执行远程代码或请求上游。保存校验不受模型开关影响，模板选型才使用有效开关；提交和计费继续遵守各自契约。原画布 HTTP/事务存储尚未挂载，验收范围见 [画布文档与插件规则](UI_PARITY_MIGRATION.md#原画布文档与插件规则隔离验证)。

未声明 `studio` 的 1.0.0 模型保留独立开关和单一价格；其 `hidden` 仍是开发版目录提示。声明 `studio` 后，隐藏模型不能通过开关启用，准入由全局与团队目录策略决定，价格来自档位。Advanced 管理接口创建的连接默认关闭；原对话设置保存首次创建的连接按原行为可用。已有的连接级工作区权限仍作为额外限制，不能覆盖目录拒绝。一个插件可创建多个连接，每个连接有独立凭据和并发限制。

### 原界面目录与分档计费

`models[].studio` 含 `order`、`priceOrder`、原描述对象 `descriptor`、可选 `runtime` 和 `prices`。每个档位声明稳定 `tier`、原 `label`、初始 `amount`（正整数或 null），以及作用于校验并填入默认值后的任务 `params` 的 JSON Schema `match`。提交必须恰好命中一个档位，null 价格禁止提交。匹配不会修改参数。示例见 `plugins/*/src/studio.ts`。同一公开模型 ID 只能属于一个插件；一个可见分组不能混用生成类型。

安装新插件会原子注册目录和档位，并推进策略/价格修订；重复安装不改设置。已有模型的新版本保持待激活，防止安装时暗中改变当前配置。当前激活要求保留已有模型编号；停用通过隐藏标记表示。新增档位采用新版本初始价，已有档位保留管理员设置。

Advanced 管理接口为 `GET /api/admin/studio-catalog`、`PATCH /api/admin/studio-catalog/models`、`PUT /api/admin/studio-catalog/prices`。修改结构与原 `/api/settings/models`、`/api/settings/prices` 相同（分别为模型/分组开关及完整 `values` 映射，均带 `expected_revision`）；团队参数使用原数字 `public_id`，内部统一解析到 UUID 工作区。两种协议使用同一 PostgreSQL 身份权威，均不得与 Python/SQLite 会话混接到默认 UI。

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
