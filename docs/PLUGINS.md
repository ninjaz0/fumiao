# 插件开发

## 工作台插件包

管理员在「设置 → 插件」导入一个 `.fmplugin.json` 文件。确认页列出版本、模型、设置字段和新增能力。导入后默认关闭。服务地址填写从 API 和任务进程可访问的根地址。测试连接只读取健康状态或模型列表。勾选模型、设置价格并打开开关后，创作者就能在原来的位置选择模型。价格为 0 表示免费，留空表示该档位尚未定价。

同一插件可以添加多个服务。第一个服务默认承接任务，管理员可以按模型切换。两个插件要提供同一个公开模型时，以相同的稳定模型 ID 发布，并由新增插件通过包顶层的 `equivalentModels` 声明这些 ID。平台核对模型种类、输入和计价规则，管理员手动选择全站默认服务。独立模型用不同 ID，可以有相同显示名。已受理的任务保留插件版本、服务、配置和价格。

首批独立文件见 [Flow](../plugins/flow/flow.fmplugin.json)、[Muse](../plugins/muse/muse.fmplugin.json)、[GPU 节点](../plugins/gpu/gpu.fmplugin.json) 和 [兼容对话](../plugins/compatible-chat/compatible-chat.fmplugin.json)。GPU 包附带配对页面、执行协议和机器安装文件。安装后管理员即可配对。关闭停止接收新的生成请求，移除会等待已受理的任务结算，再清理连接和密钥。每台机器的程序由管理员单独更新。

在「兼容对话 → 设置」中选择提供方，展开「更多设置」填写 API 密钥。使用自建兼容服务时填写 API 根地址，留空会使用提供方默认地址。保存并测试连接，再打开插件开关。每个提供方可建一个连接。`deepseek` 提供 DeepSeek Flash，`openai` 提供 GPT-4.1。创作者在「对话」中发送消息，生成定价按每条完整回复设置积分。

兼容对话 2.0.0 的 `manifest.chat.sandbox` 包含请求映射、逐行回复解析、标题和连接探测程序。管理员导入时可以看到默认服务域名和密钥注入权限。宿主向管理员配置的公网 HTTPS 服务发送请求，并在发送时加入 Bearer 密钥。沙箱只接收提供方标识、模型和本次请求数据。升级时遇到 HTTP、内网地址或无法解析的地址，系统保留该连接的配置，只暂停它接收新任务。管理员在「设置 → 插件」编辑服务地址；更换服务源时重新填写密钥。保存有效的公网 HTTPS 地址后，该连接按原启用状态接单。已受理的对话按接单时冻结的适配器版本和服务配置完成。旧版 1.2.1 的发行文件保存在 `plugins/compatible-chat/package/legacy-1.2.1.fmplugin.json`，供旧库恢复及在途任务使用。

### 发布与更新

文件顶层包含 `format: 1`、`id`、`label`、`version` 和 `adapterVersion`。版本采用三个非负整数，以点分隔。直接接入服务的通用包包含 `manifest` 和 `program`。清单按下文 v3 契约声明模型、参数和价格。程序是一个 JavaScript 对象表达式，提供 `request({model,kind,input,remoteId})` 和 `result({raw,model,kind,remoteId})`。前者返回同源的 `{path,body}`，省略 body 为 GET；后者把服务响应映射成下文的任务回执。程序在受时间和内存限制的 QuickJS 中处理 JSON，平台负责携带密钥发请求。已有独立协议服务可在同一个包中用 `remote: {endpoint,manifest}` 作为接入方式。

Flow 和 Muse 2.0.0 使用请求工作台契约 `originalSubmission.version = 5`。安装确认页列出服务连接、密钥注入和媒体验收权限。工作台程序的 SHA-256 摘要随适配器版本冻结。宿主向管理员配置的公网 HTTPS 服务注入密钥，读取本次任务的参考图，校验输出图片或视频后扣费。升级时旧 HTTP 或内网连接保留设置，已接单的任务按原配置和价格完成。管理员在「设置 → 插件」更换服务地址并保存后，该连接恢复接收新任务。

Flow 在同一契约下声明 `stream: "sse"`。宿主向连接发送生成请求，每次在独立线程的 QuickJS 实例中解析一个响应。流程序最多接收 8 MiB 解压数据，可用堆内存 64 MiB，累计执行时间上限 5 秒。进度写入沿用当前任务的租约。遇到断线时结束本次提交，管理员可从 Flow 后台核对结果。服务缓存路径使用连接密钥下载。Google 成品域名显示在安装授权页，下载使用匿名 HTTPS，并重新检查实际连接目标。

Flow 和 Muse 的 1.0.0 发行包、GPU 和兼容对话的旧版发行包保存在各自的 `package/legacy-*.fmplugin.json`。恢复旧库或安装这些版本时，宿主核对归档中的适配器字节，并使用随宿主发布的历史实现。已接单的 Flow 和 Muse 任务若在升级后仍需派发，Worker 使用接单时的服务配置检查旧提供方的容量，按原价结算。四个插件的 2.0.0 发行包均使用沙箱程序。运行 `pnpm plugins:pack` 可重建沙箱发行包并核对历史归档。

`updateUrl` 可以指向自建 HTTP(S) 服务器上的清单，也可以指向以 `.git` 结尾的 HTTP(S) Git 仓库。Git 读取默认分支根目录的 `update.json`，包和清单来自同一次提交。HTTP 包从同源地址读取。以下示例中的摘要须替换为发布文件原始字节的 SHA-256。

```json
{"id":"demo","version":"1.1.0","notes":"增加高清档位","package":"demo.fmplugin.json","sha256":"<64 位小写十六进制摘要>"}
```

平台每天检查一次。管理员也可以点击「检查更新」，检查记录显示在插件设置中。检测到新版后，卡片显示更新按钮，确认时再次校验下载内容。更新前使用已有服务配置做只读检查。新增模型默认关闭，有定价覆盖的档位沿用原价，可在设置中回到上一版本。管理员可覆盖作者的更新地址并填写独立的只读凭据。Git 服务器使用 Bearer 时填令牌，要求 HTTP Basic 时填 `用户名:只读令牌`。发布到私服时同时上传两个文件；离线环境可手动导入完整包。

## 为 Studio 设置贡献页面

在包顶层添加 `contributes`，安装后即可从 Studio 设置打开插件自己的页面。示例包的「目录显示设置」保存全站偏好，「示例模型概览」按该偏好展示模型，并允许每个工作区单独决定是否显示停用模型。两页都可在包停用时打开，无需配置模型服务。可直接对照[示例源码](../plugins/example-extension/package/release.json)和[可导入的单文件包](../plugins/example-extension/example-extension.fmplugin.json)。

### 声明页面与权限

| `contributes` 字段 | 作者填写的内容 |
|---|---|
| `version` | 固定为 `1`。包版本仍由顶层 `version` 指定。 |
| `settingsPages` | 最多 8 页。每页提供 `id`、`title` 和 QuickJS 对象表达式 `program`。可指定 `icon`、`group`（account / services / billing / organization）、`order`（0–1000）、`audience`、`visibleWhen`、`scopes` 和 `actions`。 |
| `settings` | `global` 和 `workspace` 各自声明一个对象 JSON Schema，可选 `migrate` 函数表达式。给必填字段提供有效默认值，使首次打开页面即可编辑。密钥放在连接的 `configSchema` 中，插件设置禁止 `writeOnly: true`。 |
| `hostCapabilities` | 默认空数组。读取节点或调用节点操作需声明 `nodes`，宿主还会检查 pull 模式、节点程序和适配器导出的 `NodeManagement`。 |

页面 ID 在包内唯一，操作 ID 在页内唯一。两者均以小写字母开头，可含小写字母、数字、连字符，最长 32 字符。导航键为 `plugin:<插件 ID>:<页面 ID>`。`visibleWhen: "installed"` 在安装后持续显示到移除完成，`"enabled"` 只在启用时显示。默认受众 `admin`。成员页使用 `member`，只读，并且只对能访问当前工作区的用户开放。

`view(input)` 中的字段由服务端按本页的 `scopes` 组装。只声明页面实际用到的范围。

| scope | 可读取的数据 | 成员页可用 |
|---|---|---|
| `plugin` | 本包的标识、名称、版本、启用与移除状态、在途数 | 是 |
| `models` | 本包模型的 ID、名称、类型和启用状态 | 是 |
| `services` | 本包连接的 ID、名称和启用状态，连接配置保密 | 否 |
| `jobs` | 最近最多 100 条任务摘要。成员只可看当前工作区自己的本插件任务；摘要省略提示词、媒体和用户身份 | 是 |
| `settings` | 本包的全站及当前工作区设置，每个范围为 `{values, revision}`，未声明的范围为 `null` | 是 |
| `nodes` | 已配对节点及可安装的节点模型，需 `nodes` 能力 | 否 |

每页最多声明 16 个操作，均由管理员执行。安装确认页列出每页标题、受众、读取范围、操作及设置范围。升级时检查新增页面和扩大的权限。宿主在执行时再次校验权限，记录操作者、工作区、目标和结果。

| 操作声明 | 调用与结果 |
|---|---|
| `{id, kind: "settings", scope}` | 表单的 `payload` 替换指定范围的完整设置。表单应带上读取时的 `revision`。 |
| `{id, kind: "program"}` | QuickJS 调用本页的 `action(id, payload, input)`，读取范围与本页视图相同。返回值可含 `notice` 和 `settings: {global?, workspace?}`。宿主对返回的每个范围校验完整值和修订号后写入。示例只返回当前工作区的设置。 |
| `{id, kind: "host", operation}` | 引用宿主登记的 `nodes.suggestName`、`nodes.pair`、`nodes.drain`、`nodes.stop`、`nodes.resume`、`nodes.remove`。配对传 `{name, models}`，返回可复制命令；管理已有节点时以节点 ID 为 `target`。 |

### 视图块

`view(input)` 返回 `{schema: 1, title, blocks}`，可附 `description` 和主按钮 `primary`。QuickJS 只接收 JSON，可用内存 16 MB，每次执行限时 100 ms，输出上限 2 MB。页面按宿主提供的块组合，样式、对话框和焦点由 Studio 处理。

| 块类型 | 字段与用途 |
|---|---|
| `notice` / `text` | `notice` 用 `tone` 和 `text` 给出提示，`text` 块只需 `text`。 |
| `stats` / `keyValue` | `items` 各项含 `label` 和字符串 `value`；统计项可附 `hint`。 |
| `list` | 提供 `empty` 空状态文案和 `rows`。每行需 `id`、`title`，可带图标、状态、`tone`、`metadata`、`detail` 和操作按钮。 |
| `form` | 提供 `id`、`fields`、`submit: {action, label}`。字段支持 text、textarea、number、select、multiselect、checkbox。以 `value` 回填字段，选项用 `{value, label}`。默认内联展示，`presentation: "dialog"` 由按钮的 `opensForm` 引用表单 ID 打开。 |

按钮用 `action` 引用本页声明的操作，提供 `label`，按需附带 `target`、`payload`（最多 4 KB）或 `confirm: {title, summary}`。确认后才执行操作。无效视图返回 422。字段长度、块数和选项上限见 [SDK 视图契约](../packages/plugin-sdk/src/contributions.ts)。

### 设置的保存、升级与回滚

1. **首次读取**。没有记录时，宿主从该范围的 schema 填充默认值并返回 `revision: 0`。
2. **保存**。宿主验证完整对象（上限 64 KB）并比对修订号。成功后修订号加一；若其他管理员先保存，返回 409。刷新页面取得最新值，再确认要提交的修改。
3. **升级**。宿主逐条将已保存的值传给目标版本的 `migrate(values, {scope, from, to})`，并按目标 schema 校验。没有迁移函数时直接校验原值。旧值随升级事务保留，任一迁移或校验失败会撤销整个升级。示例将 1.0.0 的全站 `useModelIds` 转为 `labelMode`，工作区的 `includeDisabled` 改名为 `showDisabled`。
4. **回滚**。恢复目标版本升级前保存的值；没有对应快照时，按目标版本的迁移和校验规则处理。
5. **停用和移除**。停用保留设置。移除会等待已接单任务结算，完成后清除本插件各范围的设置，重新安装从默认值开始。

### 在页面程序里调用宿主

页面程序的 `view` 和 `action` 可以是 `async`，最后一个参数是 `host`。包在 `contributes.hostCapabilities` 里声明要用的能力，管理员在安装确认页逐条看到，宿主在每次调用时检查。没有声明的能力在 `host` 上不存在。

| 能力 | 声明 | 函数 |
|---|---|---|
| `media` | `"hostCapabilities": ["media"]` | `probe(id)`、`transcode(id, {format})`、`concat(ids, {format})`、`extractFrame(id, {seconds})`，均位于 `host.media` |
| `data` | `"hostCapabilities": ["data"]` | `host.data.get(key, {scope?})`、`list(prefix?, {scope?})`、`put(key, value, {scope?})`、`delete(key, {scope?})` |
| `http` | `"hostCapabilities": ["http"]` 加 `"http": {"origins": ["https://api.example.com"]}` | `host.http.fetch(url, {method?, headers?, json? 或 body?})`，返回 `{status, ok, contentType, text, json}` |

- **读和写分开**。`view` 只拿到读函数（`data.get`、`data.list`、`media.probe`）。`http.fetch` 和写入只在 `action` 里可用，并和这次操作的审计记录一起提交；操作失败时已写入的数据一并撤销。
- **`data`** 是属于这个插件的键值存储，`scope` 为 `workspace`（默认）或 `global`。键最长 200 个字符，单个值上限 256 KB，每个插件合计 16 MB、2000 个键。插件不建表，移除插件时数据一并清除。
- **`http`** 只能访问声明过的 HTTPS 源。宿主拒绝指向回环、内网、链路本地和云元数据地址的请求，不跟随重定向（3xx 原样返回），请求正文上限 256 KB，响应上限 1 MB，单次 10 秒超时。不能设置 `Cookie`、`Host` 等由宿主负责的请求头。
- **限额**。一次调用最多 32 次宿主调用，插件自身的执行时间上限 250 毫秒（等待宿主的时间不计），总时长上限 15 秒。
- **失败**。宿主调用失败时 `await` 抛出 `Error`，`message` 是简短说明，可以用 `try / catch` 处理。

```js
export default {
  async view(input, host) {
    const last = await host.data.get("last");
    return { schema: 1, title: "同步状态", blocks: [{ type: "text", text: last ? "上次同步：" + last.at : "尚未同步" }] };
  },
  async action(id, payload, input, host) {
    const res = await host.http.fetch("https://api.example.com/v1/sync", { method: "POST", json: { since: payload.since } });
    if (!res.ok) throw Error("同步失败");
    await host.data.put("last", { at: payload.at, count: res.json.count });
    return { notice: "已同步 " + res.json.count + " 项" };
  },
};
```

示例包的「工作区备注」页（[`notes.js`](../plugins/example-extension/package/notes.js)）用 `data` 能力保存每个工作区自己的备注。不使用 `host` 的同步写法仍然有效，已发布的包不需要修改。

### 本地调试示例

在 `plugins/example-extension/package/` 修改声明和程序。仓库打包脚本从 `release.json` 读取贡献声明。`programFile` 和 `migrateFile` 是相对该文件的源码路径，各文件以 `export default` 导出独立表达式。打包后这两个字段分别替换为 `program` 和 `migrate` 字符串。也可以直接在声明中写表达式字符串。

```sh
pnpm plugins:pack
pnpm exec tsx --test tests/advanced/example-extension.test.ts
```

测试读取发行文件，检查更新摘要及贡献契约，用平台的 `loadProgram` 执行两个页面、一轮工作区切换和旧值迁移。查看返回内容时，可在测试中检查 `viewSchema.parse(run("view", input))`、`programActionOutputSchema.parse(run("action", id, {}, input))`。产生的包内含一个 request 模式图片模型；本机需要验证生成时，可启动仓库已有的固定色卡服务（`PLUGIN_KEY=local-demo-key pnpm exec tsx plugins/example-studio/server.ts`），连接的 API 密钥填写相同值。示例 endpoint 的 `127.0.0.1:4100` 按 API 和 worker 所在环境解释，使用容器测试生成时需在打包前改为两者都能访问的服务地址。

在支持扩展 v1 的 Studio 中，以管理员进入 `/studio` → 设置 → 插件，导入[示例包](../plugins/example-extension/example-extension.fmplugin.json)。确认权限后，在「生成服务 → 目录显示设置」选择「模型 ID」并保存。在「示例模型概览」确认行标题变为模型 ID，点击「隐藏停用模型」，切换到另一个首次使用的工作区，那里仍显示停用模型。用两个标签页同时打开全站表单，可以复测过期修订号的 409。

旧 GPU 包继续使用顶层 `settingsPage: {title, render}`。宿主将它映射为「账户」分组的 `nodes` 页，保留旧节点面板、配对操作和原发行字节。新包使用 `contributes.settingsPages`；同一文件同时声明两种格式会在导入时被拒绝。

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

沙箱图片或视频提供方可在清单里声明 `artifactValidation.version = 3`，并申请 `media` 能力。宿主在写入私有存储和结算前解码图片，或验证视频容器、尺寸、时长、旋转和第一帧。程序通过 `artifactValidation.errors` 的 `imageFormat`、`imageDecode`、`video`、`failed` 和可选的 `recovering` 字段提供失败提示。已接单任务使用冻结版本的声明。

运行 `pnpm build && pnpm test:studio:remote-provider` 可用临时 PostgreSQL、Redis、私有存储和回环提供方复现。需要 Chromium、`initdb`、`postgres`、`redis-server`、`ffmpeg` 和 `ffprobe`。PostgreSQL 和 Redis 可分别用 `PG_BINDIR` 和 `REDIS_SERVER` 指定。

## 按模型注册 Studio 参数

原生适配器通过 `modelForm(model)` 注册比例、清晰度、时长、参考模式等控件和默认值。平台按插件 ID 和版本保存这份声明，Studio 通过 `/api/state` 的 `model_forms[模型 ID]` 读取当前生效的版本。画布使用已注册画布提交能力的模型。已有的远程连接会在启动时补齐表单。

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

通过此接口升级传统适配器后，请重新核验并启用连接。迁至公网 HTTPS 沙箱的连接保留原启用状态，地址不合规时只暂停新任务。未绑定目录的模型仍需单独开放。激活新的目录版本时，在上述请求中增加 `"activateCatalog": true`。目录激活会推进策略/价格修订，其他连接须升级到相同目录版本后才能接受新任务；现有隐藏覆盖和管理员价格保留。已经接受的任务保留原插件版本、模型、凭据与价格快照；旧版本必须保持可用，直到任务全部结算。插件不能通过覆盖版本改变已接受任务的行为。

`POST /api/admin/jobs/:id/resolve` 用于核对 `uncertain` 任务，可填写上游编号恢复查询，或在确认后结束任务并释放积分。所有核对都记录理由和操作者。

取消排队任务会立即释放积分。运行中的外部任务只有在提供方确认取消后才能释放；不支持取消的提供方会继续等待最终结果。GPU 执行端在心跳中接收取消请求。

通过「设置 → 插件」导入含 `contributes.paymentMethods` 的包，再配置商户。随仓库提供的「充值渠道」包含支付宝和 USDT-Plasma。下单、查单和回调映射在沙箱运行，宿主负责密钥、网关核对与积分结算。见 [扩展契约](PLUGIN_EXTENSIBILITY.md)。

### 节点池 v1

管理员可以从 Studio 的插件设置导入 `plugins/example-node-pool/example-node-pool.fmplugin.json`，启用后在「ComfyUI 节点」生成接入命令。准备一台运行 ComfyUI 的 Linux 机器，导出 API 格式的工作流，设置 `COMFY_WORKFLOW` 为文件路径，`COMFY_PROMPT_NODE` 为文本节点 ID。工作流需要一个保存 PNG 的输出节点。节点端默认连接本机 8188 端口，通过 `COMFY_URL` 可以指定自己的 ComfyUI 服务。在该机器运行接入命令，保持进程在线，然后在 Studio 选择「ComfyUI 图像」提交任务。

清单使用 `mode: "pull"`、Studio 提交契约 v3、`contributes.nodePools: { "version": 1 }` 和 `hostCapabilities: ["nodes", "media"]`。模型参数、表单和价格沿用 Studio 模型清单。节点安装器、压缩包和 SHA-256 摘要放在 `nodeClient` 中。管理员页面使用设置页的 `nodes` 读取范围和 `nodes.pair` 等宿主操作。示例的全部策略在 `plugins/example-node-pool/package/program.js`。

节点池的五个策略是同步 QuickJS 扩展点。宿主根据节点当前安装版本处理能力上报，用接单时冻结的包版本执行四项任务策略。

| 函数 | 输入与返回值 |
| --- | --- |
| `capabilities(report)` | 归一化节点心跳的 `capabilities` 对象，返回就绪模型、可选特性及并发通道计划。第二个参数为节点获准运行的模型列表。模型必须在配对授权内，输出上限 16 KiB。 |
| `eligible(node, job)` | 从队列模型、输入和节点能力判断是否接单，返回布尔值。宿主另行检查节点控制状态、心跳和领取权限。 |
| `dispatch(job, node)` | 返回 JSON 指令对象。任务含 `model`、`kind`、`input.prompt`、`input.params`、`input.references`。素材路径由宿主按工作区生成。 |
| `receipt(job, report)` | 读取与派发相同的任务输入，验证回传的 JSON 报告。返回 `true` 或含补充元数据与计时的对象后进入媒体验收。 |
| `artifactRules(job)` | 声明 MIME、字节上限和可选的尺寸、时长、音视频编码、帧数、帧率、声道及采样率。字段定义见 `packages/plugin-sdk/src/node-pools.ts`。 |

节点访问 `/agent/<插件 ID>/client/{install.sh,agent.tgz,agent.tgz.sha256}`。安装器收到 `FUMIAO_SITE`、`--models=<模型列表>` 和配对码。协议沿用以下 HTTP 方法，所有路径都位于 `/agent/<插件 ID>` 下。

| 请求 | 约定 |
| --- | --- |
| `POST /enroll` | 提交 `{code,secret}`，由节点生成并私下保存随机凭据。同一码仅能绑定同一凭据。 |
| `GET /registration` | 返回已授权模型和控制状态。此请求及下列请求使用节点的 Bearer 凭据。 |
| `POST /heartbeat` | 提交 `{stage,capabilities,ticket?}`。工作中定期续约，响应的 `held` 表示是否仍持有该任务。 |
| `POST /claim` | 返回 `{job:null}` 或含 `id`、`ticket`、`instruction` 的任务。 |
| `GET /jobs/:id/ref/:key` | 读取当前任务的参考素材。任务操作还需 `X-Job-Ticket`。 |
| `PUT /jobs/:id/result` | 原始成品字节，`X-Sha256` 为 hex 摘要，`X-Job-Timing` 为 JSON 回执。宿主校验后保存私有素材并结算。 |
| `POST /jobs/:id/error`、`GET /jobs/:id/receipt` | 上报 `{stage:"error",detail}` 或查询是否已收到成片。重复成功回传返回同一素材。 |

`037_node_pools.sql` 原地重命名节点和配对表，保留旧表名的可更新视图。`node_pools` 从已有 pull 连接读取插件归属。原有节点、任务票据、序列、账本和已冻结的包版本继续沿用。GPU 2.0 的新任务使用包内工作台策略和节点池程序。1.x 已受理任务继续按冻结版本结算。

### 工作区媒体处理

调用传入当前工作区素材的 32 位公开 ID。探测返回 MIME、秒数、尺寸、编码、声道和采样率。转码、拼接与抽帧在管理员操作中可用，返回相同类型的信息以及新素材 ID。原素材继续可读。输出计入存储配额，操作失败或事务回滚会清理新文件。审计记录调用名称、次数、工作区和操作结果。

`format` 接受 `mp4`（H.264 视频，有音轨时为 AAC）或 `wav`（PCM 音频）。抽帧输出 PNG。拼接接受 2–8 个按播放顺序排列的 ID，视频需全部带音轨或全部无音轨。单次输入合计上限为 64 MiB、120 秒，输入画面上限为 16777216 像素。单个 API 进程最多并行处理两项操作。FFmpeg 和临时目录由宿主管理。ComfyUI 节点池示例包在设置的「素材处理示例」页提供这四项操作。

### GPU 2.0 切换和回退

在设置中停用 GPU 插件，保留工作机在线，等已受理的排队和运行中任务完成。升级前按运维手册备份数据库和对应的私有媒体。导入 2.0 后在「GPU 节点」生成新命令并到机器上运行，模型就绪后启用。跨协议升级与回退会检查待结算任务，撤销旧节点凭据并使未用配对码过期。切回 1.x 也需排空并重新配对。包更新沿用原模型、服务连接、价格与历史作品。恢复整库时，使用同一时间点的数据库和媒体备份。

GPU 2.0 声明 `originalSubmission.version = 4`。清单内的 SHA-256 固定 `studioProgram`，该程序在 QuickJS 中提供输入准备、模型表单、计时、队列和状态投影。宿主校验素材权限、预估与计费输入，执行参考素材转换。节点回执可返回 `true` 或含 `metadata`、`timing` 的对象。宿主独立测量的媒体字段优先。单声道 PCM 的最小峰值和视频旋转要求可通过 `artifactRules` 声明。

### 事件订阅与菜单操作

在 Studio 设置的插件页导入并启用「素材自动分类」和「审片备注」。上传一张新参考图，打开素材详情的「更多 → 查看素材分类」。在一个任务详情的「更多 → 填写审片备注」保存文字，再点「查看审片备注」复核。启用「素材自动分类」前上传的素材没有分类记录。两包均可独立启用和停用。

包格式、事件类型、重试、死信与权限见[工作区事件与资源菜单](PLUGIN_EXTENSIBILITY.md#工作区事件与资源菜单)。
