# 导演台单集制作实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal** 从 `/studio` 进入当前画布，选剧本，确认分镜与素材，预检生成，逐镜选版，导出本集 MP4。

**Architecture** 剧本继续使用工作区文档。导演台使用画布节点、镜序、媒体和任务列表，生产确认和本集成员通过已有画布保存。生成与合成在已有服务中校验确认的输入，保留原有队列、回执和媒体权限。

**Tech Stack** Next.js、React、NestJS、PostgreSQL、BullMQ、FFmpeg、Node 24、pnpm 10.32.1、Node Test、Playwright。

**Spec** [导演台单集制作设计](../specs/2026-11-27-director-desk-design.md) `a2b70a4`。

## 全局约束

- 一张画布、一份主剧本、一份经导演确认的本集片单。试拍须明确加入。片单从 `document.shots` 取相对顺序。
- 分镜和纳入范围同屏确认，素材单独确认，提交前确认报价，生成后明确采用每镜视频。
- 通过当前画布的乐观锁和本地草稿保存导演台状态。重复提交只恢复同一回执，明确补跑才创建新的付费操作。
- MP4 最多 30 镜、5 分钟。渲染以实际媒体时长为准。另一个工作区的剧本和媒体不能成为本集输入。
- Web 仅使用允许的共享契约。新增跨端类型与纯函数放在 `@fumiao/web-compat/director.js`。依赖沿用现有 workspace 和锁文件。
- 使用 T3 当前 worktree。执行时先运行 `pnpm install --frozen-lockfile`。本机可见 Node 24 和 Docker，`pnpm`、`corepack` 当前不在终端 PATH，仓库 Dockerfile 提供锁定版本的 pnpm。[环境说明](../../STUDIO.md)

## 评审重点

1. 复制试拍携带相同剧本标识，首次开启导演台要能消歧。任务 2 覆盖。
2. 参考图或声线可在画布版本未变时更新，报价必须与接单输入一致。任务 3 覆盖。
3. 同一报价可能用于不同的逻辑提交，丢失响应和主动补跑要区分。任务 4 覆盖。
4. 删除、移出、重排镜头或归档恢复，不能误用上次确认顺序。任务 1 和任务 2 覆盖。
5. 已配对白、仅旁白及保留原声的镜头应同时进入同一成片，补抽不得替换既有采用。任务 1 和任务 5 覆盖。

## 任务 1　持久化本集片单并按范围合成

**文件** `packages/web-compat/src/director.ts`、`packages/original-api/src/canvas-draft.ts`、`packages/original-api/src/canvas-validation.ts`、`packages/original-api/src/canvases.ts`、`packages/original-api/src/storyboard-exports.ts`、`migrations/056_storyboard_export_scope.sql`、`apps/web/canvas-editor/types.ts`、`tests/advanced/canvases.test.ts`、`tests/advanced/storyboard-exports.test.ts`。

**接口** 在两个现有画布文档类型加入 `director?: DirectorProduction`。共享类型含 `script_id: string`、`script_revision: number`、`shot_ids: string[]`、`order_basis?: string`、`shots?: DirectorShotState[]`。`DirectorShotState` 含 `node_id: string`、`source?: Record<string, string>`（逐字段导入基线的摘要）及可选 `story_basis`、`material_basis`、`adoption_basis`。导出 `directorShotIds(shots: readonly string[], director: DirectorProduction): string[]` 并按全局镜序过滤。`directorBasis(value: unknown): Promise<string>` 对 JSON 值排序对象键后用 SHA‑256 生成 64 位十六进制字符串，数组顺序原样保留。

- [ ] 在 `canvases.test.ts` 增加 `director state round-trips and cannot reference off-list shots`，在 `storyboard-exports.test.ts` 增加 `episode export freezes adopted shots in canvas order`。断言 `assert.deepEqual(directorShotIds(["s2", "trial", "s1"], director), ["s2", "s1"])`，保存陌生节点、重复成员或非视频返回 400，旧画布保存不要求新字段。构建有已采用视频、不同最新候选及试拍的 fixture，断言冻结快照只有 `s2`、`s1` 及其指定媒体。再断言缺失采用、顺序基线过期、10 分钟成片渲染或 31 镜 MP4 被拒绝，保留原声可带台词，已配对白只要求对白音轨。
- [ ] 运行 `pnpm exec tsx --test tests/advanced/canvases.test.ts tests/advanced/storyboard-exports.test.ts`。配置隔离的 `TEST_DATABASE_URL` 后确认新行为断言失败。
- [ ] 声明画布可选字段和服务端引用校验。新绑定主剧本时校验工作区和访问权。老调用方省略 `director` 字段时沿用已保存的导演台状态。画布删除或移出 `document.shots` 时移除对应成员并使本集顺序待确认。画布副本继承节点与可用显式媒体，重新确认本集内容。
- [ ] 导出请求加入 `scope?: "canvas" | "episode"`，缺省为 `canvas`。`storyboard_exports.scope` 使用带默认值 `canvas` 的新字段。`scope === "episode"` 时锁画布版本，校验 `order_basis`，按本集片单冻结显式 `active_job` 或 `use_media + media_id` 的媒体与音轨。将范围用于回执身份和公开历史。复用现有资源权限检查和渲染队列。MP4 使用 `storyboard/mp4`。按 `keep_original`、有对白、仅旁白三个分支处理本集所需音频。
- [ ] 重跑上述命令，确认新增用例及旧版全画布导出用例通过。覆盖同一提交号跨范围返回 409、同范围原请求可回放。提交 `feat: 支持本集片单保存和指定范围合成`。

## 任务 2　从剧本文档进入导演台并确认分镜

**文件** `apps/web/canvas-editor/DirectorDesk.tsx`、`apps/web/canvas-editor/director-desk.css`、`apps/web/canvas-editor/CanvasEditor.tsx`、`apps/web/canvas-editor/CanvasWorkspace.tsx`、`apps/web/canvas-editor/ScriptWorkspace.tsx`、`apps/web/canvas-editor/ScriptSyncModal.tsx`、`apps/web/canvas-editor/script-fusion.ts`、`tests/advanced/script-canvas-fusion.test.ts`、`tests/integration/script-workspace-fusion-browser.ts`。

**接口** `ScriptWorkspace` 增加 `onOpenDirector(request: { docId: string; nodeId?: string }): void`。同步 UI 接受目的地 `"document" | "canvas" | "director"` 并支持 `flushCanvas(): Promise<number>`。在 `script-fusion.ts` 增加 `directorSourceChanges(base: Readonly<Record<string, string>>, current: Readonly<Record<string, string>>, incoming: Readonly<Record<string, string>>): { takeScript: string[]; preserve: string[]; conflicts: string[] }`。参数为同一组字段的摘要。`DirectorDesk` 接收 `document: Doc`、`activeShotId: string | null` 及回调。视图选中镜头独立于画布的节点选中态。

- [ ] 扩展 `script-canvas-fusion.test.ts`，断言 `directorSourceChanges({prompt:"a"}, {prompt:"b"}, {prompt:"c"}).conflicts` 为 `["prompt"]`，只有剧本侧变化则采用剧本，只有画布侧变化则保留画布，无基线且内容不同显示选择。加旧镜和复制试拍同时绑定同一锚点、重同步保留媒体和用户连线的用例。为浏览器加 `doc → director → canvas reference → director` 定位路径，断言回到同一镜和步骤。
- [ ] 运行 `pnpm exec tsx --test tests/advanced/script-canvas-fusion.test.ts`，确认新合并和匹配断言失败。
- [ ] 复用文档会话、拆解预览及现有歧义确认。分镜预览让导演调整说明、顺序与纳入范围。默认候选仅为主剧本唯一匹配的镜头，有歧义显式选择。按逐字段基线合并原文和导演手改，保留已出片媒体、在途任务和手工连线。支持带来源跳转而无正式绑定的副本。先保存剧本，再把同步结果与本集状态作为同一画布改动保存，成功后跳到导演台。剧本保存成功而画布冲突时保留草稿，用稳定标识重试。已有结构化拆解无镜头时提供编辑提示和创作助手入口。
- [ ] 新增同级「导演台」和文档入口。导演台展示原文摘录、片单、来源、确认差异及「定位画布」。上游选中图片时保持导演台镜头上下文。重排本集节点只交换全局镜序中的本集位置，显式保存顺序确认。对归档和恢复使用现有画布编辑路径。
- [ ] 重跑 `script-canvas-fusion.test.ts`、`pnpm typecheck:web`，完成首次构建后运行 `pnpm exec tsx tests/integration/script-workspace-fusion-browser.ts`。提交 `feat: 连接剧本文档与导演台分镜`。

## 任务 3　确认准确的素材与生成输入

**文件** `apps/web/canvas-editor/DirectorDesk.tsx`、`apps/web/canvas-editor/CanvasWorkspace.tsx`、`packages/web-compat/src/director.ts`、`packages/original-api/src/director-inputs.ts`、`packages/original-api/src/canvas-runs.ts`、`packages/original-api/src/batch-precheck.ts`、`packages/original-api/src/dialogue.ts`、`tests/advanced/batch-tailchain-canvas-packs-series.test.ts`。

**接口** `DirectorTarget = { node_id: string; stage: "image" | "video" | "narration" | "dialogue"; line_id?: string }`。`resolveDirectorInputBasis(sql: Sql, project: { id: string; workspace_id: string }, document: CanvasDocument, target: DirectorTarget): Promise<string>` 返回实际会使用的输入摘要。预检票据与付费接单复用同一解析过程。画布的分镜确认摘要由视频节点及其有效文案算出，素材确认依据包含固定媒体、素材包版本和实际解析的配音设置。

- [ ] 添加 `director input basis covers resolved reference and voice`。用现有数据库 fixture 直接调用 `resolveDirectorInputBasis`。在相同画布和价格版本下分别更换跟随最新的参考图和角色包声线，断言 `assert.notEqual(after, before)`。固定上游参考图并补抽后，断言 `assert.equal(after, before)`。加入缺图和自动尾帧需要显式处理的输入检查。
- [ ] 运行 `pnpm exec tsx --test tests/advanced/batch-tailchain-canvas-packs-series.test.ts`，确认新增断言失败。
- [ ] 用现有素材包、上传及画布图片生成操作连接素材准备。为选择的参考图写入明确输出或媒体，展示缺失或改动以及受影响的镜头。先预检并生成图片，导演选定后才可预检依赖视频。新建导演台镜头默认关闭自动尾帧。已有自动继承在导演台提示来源，保留画布固定尾帧为首帧的入口。
- [ ] 从现有提交解析提取可复用部分。摘要包含生成相关的有效提示词、媒体顺序、首尾帧、素材包及版本、模型参数和实际声线设置。形成可从报价或接单事务调用的解析。导演台状态变化只使相关确认失效。重跑上述测试后提交 `feat: 确认导演台实际生成素材`。

## 任务 4　按镜头和对白句报价、生成与恢复

**文件** `packages/original-api/src/canvas-draft.ts`、`packages/original-api/src/batch-precheck.ts`、`packages/original-api/src/canvas-runs.ts`、`apps/web/canvas-editor/PrecheckCostModal.tsx`、`apps/web/canvas-editor/CanvasWorkspace.tsx`、`apps/web/canvas-editor/DirectorDesk.tsx`、`tests/advanced/batch-tailchain-canvas-packs-series.test.ts`。

**接口** 原 `/batch-precheck` 和 `/batch-runs` 支持 `director: { script_revision: number; use_confirmed_script?: boolean; targets: DirectorTarget[] }`，沿用 `expected_revision`、`precheck_token`、`price_revision` 和 `uid`。在 `director` 请求中从已保存画布核对主剧本，`line_id` 仅用于对白且必须属于该镜。用规范化后的目标、各项摘要和版本生成预检凭证。执行项的键包括 `line_id`。每次确认付费创建一个逻辑提交，保留完整原请求和 `uid` 至回执可恢复。

- [ ] 加 `director retries one failed line and recovers accepted receipt`。使两个对白中一条成功、一条失败。断言补跑报价及回执只含失败 `line_id`，成功任务和冻结额未变化。用同一原请求重复提交验证 `assert.deepEqual(replay, accepted)` 与只冻结一次。用相同票据和新 `uid` 明确补跑，断言返回新任务 ID。另在预检后更改主剧本或可变输入，断言旧依据下未接单项被拒绝，已接单项的输入与回执仍可恢复。覆盖继续用已确认剧本版本及回执后挂接冲突。
- [ ] 运行 `pnpm exec tsx --test tests/advanced/batch-tailchain-canvas-packs-series.test.ts` 并确认新行为未实现。
- [ ] 让导演台按实际需要构建目标。对白镜仅发待生成的对白句，旁白镜发旁白，保留原声的镜头发视频。兼容原 `node_ids` 与 `stages` 请求。使用现有批量回执、锁、逐项接单和计费代码，复用单句的配音实现。接单事务内校验任务 3 的目标摘要，用核对过的值构建任务请求。锁定报价时已明确选择的剧本依据，允许用户确认按上一次已同步内容继续。票据变更后让未接单项重新预检。
- [ ] 在预检弹窗区分「恢复上次提交」和「重新预检并补跑」。网络丢响应时重放原请求，明确补跑时使用新的 `uid`，即使报价摘要相同。已有回执时独立恢复画布中的待完成音轨引用。分开呈现已接单与跳过的条目。重跑上述测试和 `pnpm typecheck`，提交 `feat: 支持导演台精确预检与任务恢复`。

## 任务 5　逐镜选版、正式入口和验收

**文件** `apps/web/canvas-editor/DirectorDesk.tsx`、`apps/web/canvas-editor/CanvasWorkspace.tsx`、`apps/web/canvas-editor/VideoVersions.tsx`、`apps/web/canvas-editor/Composition.tsx`、`tests/integration/director-desk-browser.ts`、`tests/integration/studio-remote-provider.ts`、`package.json`。

**接口** `Composition` 增加 `scope?: "canvas" | "episode"`，导演台传 `"episode"`。范围随原请求持久化并过滤历史。候选接口复用现有生成任务，主动采用写 `active_job` 或明确使用现有媒体，记录采用时的确认依据。

- [ ] 增加 `director exports only adopted shots` 场景，从工作区成员登录 `/studio` 进入画布。使用可解码的不同颜色视频和已有图作为可辨认样本。先用一镜正片和一镜试拍，断言 MP4 只含正片的已采用画面。扩展三镜测试对白、旁白、保留原声和首次失败。断言服务器回执恢复后同一任务只冻结一次，补抽后 MP4 仍使用明确采用的旧候选。375px 重走换参考图并回到同一镜，再刷新确认片单恢复。
- [ ] 构建后运行 `pnpm exec tsx tests/integration/director-desk-browser.ts`，以符合预期的功能缺口验证红灯。使用现有本地模拟提供方的素材生成方式，核对下载的 MP4 画面、顺序、音频与数量。
- [ ] 单个完成候选提供直接采用按钮，多候选复用比较组件。补抽保留已采用的生成版本或现有媒体。素材或分镜变化后，导演可重新生成或明确沿用旧版。导演台连接本集合成状态，复用播放和下载，画布入口标明全画布。对超过 30 镜、5 分钟的预计成片在界面提示实际限制。将浏览器场景加入 `test:studio`。
- [ ] 运行 `pnpm lint`、`pnpm typecheck`、`pnpm typecheck:web`、`pnpm test`、`pnpm build`、`pnpm exec playwright install chromium`、`pnpm test:studio`，记录确实执行的检查和跳过项。使用隔离的 `python3 scripts/worktree.py up` 验证同一用户路径，随后 `down`、`status` 确认已清理。提交 `feat: 完成并验证导演台单集出片流程`。
- [ ] 从已验证 SHA 更新 `fumiao-acceptance`。沿用该实例配置与卷，执行仓库指南中的 Compose 构建，确认就绪后在 `http://localhost:3000/studio` 复测并交给负责人验收。负责人验收后按仓库流程提 PR。
