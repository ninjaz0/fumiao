# 弗淼插件 SDK

`@fumiao/plugin-sdk` 提供 Studio 插件发行包、扩展声明、视图和任务回执的 TypeScript 类型和运行时校验器。需要 Node.js 24 或更高版本。

```ts
import { packageSchema, viewSchema, type View } from "@fumiao/plugin-sdk";

const page: View = { schema: 2, title: "审片说明", blocks: [{ type: "text", text: "请选择待审任务。" }] };
viewSchema.parse(page);
```

`packageSchema.parse(JSON.parse(text))` 可检查发行包结构。Studio 导入时还会核对入口函数、宿主能力和现有安装状态。签名前保留原始发行包 JSON，签名覆盖包内容、发布者名称和公钥。对象字段顺序和文件缩进可以变化。

## 从空目录做一个旁白工具

需要 Node.js 24、pnpm 10；节点池模板还使用 Python 3。开发者只需 SDK 发行包。把维护者给你的 `.tgz` 放在一个新目录中，在那里运行以下命令。这个目录提供作者工具，`voice-length` 是生成的插件源码目录。

```sh
npm init -y
pnpm add -D ./fumiao-plugin-sdk-0.3.0.tgz
pnpm exec fumiao-plugin create chatTools voice-length
pnpm exec fumiao-plugin test voice-length
pnpm exec fumiao-plugin dev voice-length
```

打开终端输出的回环地址，选择 `chatTools.reading-time`，把第一个参数改成 `{"script":"海面日出，海风徐来","pace":"自然"}`，然后点「运行入口」。结果中应有 `estimatedSeconds: 2`。编辑 `voice-length/package/reading-time.js` 并保存，再次运行即可看到新结果。宿主使用 QuickJS、示例工作区、内存存储和模拟的媒体与支付服务。保存有错误的源码时会显示原因，修正后可以继续。按 Ctrl+C 关闭。

在工具目录构建发行包。

```sh
pnpm exec fumiao-plugin build voice-length
```

管理员登录 Studio，在「设置 → 插件」选择 `voice-length/dist/voice-length.fmplugin.json`，核对版本、权限和签名状态，确认导入并启用。使用支持工具调用的模型询问这段旁白的时长。模型可以自行决定是否调用工具。后续迭代保持插件 ID，先提高 `package/release.json` 的 `version` 再构建。这里的 `adapterVersion` 标识模型适配器，实现变化时相应升级。

## 按扩展点选择模板

`fumiao-plugin create <类型> <新目录>` 生成可运行的清单和程序。目录名也是插件 ID。下面每行都是可单独创建、运行和构建的示例。

| 类型 | 生成的示例 | 修改入口 |
| --- | --- | --- |
| `importers` | 从图片链接导入素材，或将外部分镜清单转换成工作区画布 | `package/image.js`、`package/story.js` 的 `plan` |
| `providers` | 接受任务并返回一张固定图片的 HTTP 服务 | `server.mjs`、`package/release.json` 的模型清单 |
| `nodePools` | 报告已就绪模型，领取图片任务，校验节点回执 | `package/program.js` 的五个钩子、`client/worker.py` |
| `settingsPages` | 在插件设置里添加、删除工作区备注 | `package/notes.js` 的 `view` 和 `action` |
| `settings` | 保存全站与工作区的显示选项，升级时迁移旧值 | `package/release.json` 的设置 schema、`package/migrate.js` |
| `pages` | 工作台侧栏的审片清单 | `package/board.js` |
| `canvasNodes` | 把输入文案和景别转换为镜头提示词 | `package/compose.js` |
| `actions` | 从任务菜单写入、读取审片备注 | `package/save.js`、`package/read.js` |
| `events` | 收到 `asset.created` 后保存素材分类 | `package/classify.js` |
| `chatTools` | 估算一段旁白的朗读时长 | `package/reading-time.js` |
| `exporters` | 为分镜视频生成拼接计划 | `package/plan.js` |
| `paymentMethods` | 使用宿主签名、下单并核对模拟订单 | `package/alipay.js` |

程序文件放在 `package/` 中并使用 `export default`。扩展声明的 `programFile`、设置的 `migrateFile` 和模型适配器的顶层 `programFile`、`studioProgramFile` 在构建时转换为沙箱表达式。编辑节点客户端后先从插件目录运行 `python3 client/pack.py` 再构建。远程提供方由管理员部署；在发行清单填写 API、Worker 能访问的服务地址。

## 为自己的插件写契约测试

`test <目录>` 根据清单找出入口，构造示例参数，运行程序，检查返回值。在项目根目录放入 `fixtures.json` 可以替换某个入口的参数，并要求输出精确匹配。下面用“海风”两个汉字验证自然语速的结果。

```json
{
  "inputs": {
    "chatTools.reading-time": [{"script":"海风","pace":"自然"},{"callId":"example","turn":"example-turn"}]
  },
  "expect": {
    "chatTools.reading-time": "{\"characters\":2,\"charactersPerMinute\":240,\"estimatedSeconds\":1}"
  }
}
```

`inputs` 的键采用开发宿主「扩展入口」中的名称，值为调用参数数组；`expect` 对照沙箱返回的实际 JSON 类型。工具在未知入口、参数不合规或输出偏离预期时以非零状态退出。为 HTTP 程序提供 `host` 模拟响应，例如 `{"host":{"http.fetch":{"status":200,"ok":true,"contentType":"application/json","text":"{}","json":{}}}}`。页面视图只能读取声明的能力；用户级入口使用工作区数据。重载会重置模拟数据。

远程提供方还可用真实的本机模拟服务检查 `/health`、`/submit`，以及待处理回执的 `/inspect`。在 `providers` 示例项目内安装依赖，设置专用测试口令 `PLUGIN_KEY` 后运行 `node server.mjs`。在工具目录的另一个终端设置同一测试口令，执行 `pnpm exec fumiao-plugin test <项目目录> --service http://127.0.0.1:4100`。Studio 正式环境仍需独立验证服务鉴权、结算与媒体可读性。

## 仓库开发与 SDK 分发

在弗淼仓库可直接运行 `pnpm create:plugin chatTools <新目录>`、`pnpm plugin:dev <目录>`、`pnpm plugin:test <目录>`。要向外部作者交付独立 SDK，在仓库根目录运行以下命令。输出的 tarball 带有 JavaScript、类型声明、命令行、示例和开发宿主。

```sh
pnpm build:sdk
npm pack ./packages/plugin-sdk/dist
```

`pnpm test:plugin-authors` 检查仓库的全部 `plugins/example-*`、所有模板的 Studio 安装预览、独立 tarball 安装、类型、签名和浏览器热重载。维护者获得发布授权后可从同一构建目录运行 `npm publish ./packages/plugin-sdk/dist --access public`。公开入口为 `@fumiao/plugin-sdk` 与 `@fumiao/plugin-sdk/signing`，按语义化版本升级。

## 签名与验签

在插件项目中安装 SDK 后，通过随包提供的命令生成 Ed25519 密钥、签名和检查发行包。

```sh
npx fumiao-plugin keygen ../publisher-private.pem
npx fumiao-plugin sign demo.fmplugin.json --key ../publisher-private.pem --publisher '示例作者' --out demo.signed.fmplugin.json
npx fumiao-plugin verify demo.signed.fmplugin.json
```

私钥属于发布者，保存在项目和发行文件以外。签名命令输出公钥的 SHA-256 指纹。首次导入签名包时，请管理员从独立渠道核对发布者指纹。后续换钥时，管理员在更新确认页看到原指纹和新指纹，核对后确认更换。

管理员首次导入无签名包时可以继续，预览页与安装详情会标明“未签名”。这个插件首次采用签名后，Studio 固定公钥。更新、回退和卸载后重装均核对该公钥，换回无签名包会被拒绝。
