# Muse2API 多账号并发生成支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让弗淼接入配置了多个可用账号的标准 `muse2api` 时，无需上游新增 `/v1/queue` 接口即可按启用账号数多路并行派发并接收视频任务，且排队预估车道数与连接并发上限保持一致。

**Architecture:** 将已发布的 `muse` `2.0.0` 归档为 `legacy-2.0.0.fmplugin.json`，发布 `muse` `2.1.0` 在 `/v1/queue` 非 2xx 或省略 `capacity` 时回退采用 `/readyz` 返回的启用账号数（截断至 `1..16`）。在平台层对 `manifest.queue.strategy === "capacity"` 的插件将新建连接默认 `concurrency` 设为 `16`，在排队预测与估时快照中将 `health.capacity` 按 `connection.concurrency` 取 `min`，并通过 `StudioPackages.list` 向前端暴露 `defaultConcurrency` 同步新建服务表单默认值。

**Tech Stack:** TypeScript (Node 24, ESM), Next.js / React (`apps/web`), PostgreSQL / PGlite (`packages/platform`, `packages/original-api`), esbuild 沙箱打包 (`scripts/build-studio-packages.mjs`), `node:test` (`tsx --test`).

**Spec:** `docs/superpowers/specs/2026-11-26-muse2api-multi-account-concurrency-design.md`

## Global Constraints

- 严禁原位修改已发布的 `muse` `1.x` 或 `2.0.0` 插件包内容及摘要，不得影响在途或历史任务恢复。
- 必须将当前 `plugins/muse/muse.fmplugin.json` 归档为 `plugins/muse/package/legacy-2.0.0.fmplugin.json`，并在 `scripts/build-studio-packages.mjs` 中校验其 SHA-256 摘要（`a332a61eb35e7d1f3dfb1070052a073e88729b0bf658d01da4665bbc097f7257`）。
- 不在插件升级时静默覆盖管理员已保存的存量连接 `concurrency`。
- 若 `/v1/queue` 返回 `200` 但 `capacity` 字段格式非法（如 `null`、小数、空串），保持防御性回退 `1`，不放大异常状态下的并发。
- 严格遵守 pnpm workspace 包边界（`apps/web` 不越层引用后端实现），通过 `pnpm lint`、`pnpm typecheck` 与 `pnpm typecheck:web`。

## Review Focus

- `/readyz` 返回超大账号池（如 `accounts: 30`）或非正数/空值（`0`、`-2`、`[]`、`{}`）：`30` 必须封顶为 `capacity: 16`，`0`/`-2`/`[]`/`{}` 必须返回 `{ ready: false }`。
- `/v1/queue` 返回 `200` 但省略 `capacity`（如 `{ tasks: [{ id: "ext-1" }] }`）vs 返回非法 `capacity`（如 `{ capacity: "2.5" }` 或 `{ capacity: null }`）：省略时继承 `/readyz` 账号数并扣减外部任务，非法格式时防御性回退 `{ ready: true, capacity: 1, maintenance: 0, tasks: [] }`。
- 从已安装的 `muse` `2.0.0` 升级至 `2.1.0` 时存在 `2.0.0` 在途任务且存量连接保存了自定义 `concurrency`（如 `1` 或 `3`）：在途任务继续使用 `2.0.0` 快照完成单次结算，存量连接的 `concurrency` 不被改写。
- 上游有 5 个账号（`readyz.accounts = 5`）但管理员将连接 `concurrency` 设为 `2`：`Executor` 最多同时放行 2 个任务，且 `QueueForecasts` 与 `OriginalEstimate` 也按 2 条车道计算第 3 个排队任务的等待时间。
- 管理端插件设置表单（`SettingsPlugins.tsx`）区分「新建」与「编辑」：新建 `muse` 服务默认填 `16`，新建普通插件服务默认填 `1`，编辑已保存为 `1` 或 `3` 的存量 `muse` 服务时回显原值而非 `16`。

---

### Task 1: 归档 `muse` `2.0.0` 并发布支持 `/readyz` 多账号容量回退的 `2.1.0`

**Files:**
- Create: `plugins/muse/package/legacy-2.0.0.fmplugin.json`
- Modify: `plugins/muse/package/policy.js:134-178`
- Modify: `plugins/muse/package/release.json:1-8`
- Modify: `scripts/build-studio-packages.mjs:105-164`
- Regenerate: `plugins/muse/muse.fmplugin.json`, `plugins/muse/update.json`
- Test: `tests/advanced/sandbox-request.test.ts`, `tests/advanced/installed-packages.test.ts`

**Interfaces:**
- Consumes: `@fumiao/plugin-sdk/health.js` (`healthInteger`, `healthTruthy`)
- Produces:
  - `plugins/muse/package/legacy-2.0.0.fmplugin.json` (SHA-256 `a332a61eb35e7d1f3dfb1070052a073e88729b0bf658d01da4665bbc097f7257`)
  - `plugins/muse/muse.fmplugin.json` (`version: "2.1.0"`, `adapterVersion: "2.1.0"`)
  - `queueHealth(host)` returning `{ ready: boolean, capacity?: number, maintenance?: number, tasks?: { id?: string }[] }`

- [ ] **Step 1: 在 `tests/advanced/sandbox-request.test.ts` 与 `tests/advanced/installed-packages.test.ts` 编写失败测试**

在 `tests/advanced/sandbox-request.test.ts` 的 Muse 测试中新增对 `adapter.queueHealth!(config, signal)` 的断言：
```ts
  let readyBody: unknown = { status: "ready", accounts: 4, browser_running: true },
    queueReply: { status: number; body: unknown } = { status: 404, body: null };
  // 路由分发：/readyz -> readyBody, /v1/models -> { data: [{ id: "muse-video" }] }, /v1/queue -> queueReply
  assert.deepEqual(await adapter.queueHealth!(config, signal), {
    ready: true,
    capacity: 4,
    maintenance: 0,
    tasks: [],
  });
  readyBody = { status: "ready", accounts: 30 };
  assert.equal((await adapter.queueHealth!(config, signal)).capacity, 16);
  for (const badAccounts of [0, -2, 1.5, [], {}, null]) {
    readyBody = { status: "ready", accounts: badAccounts };
    assert.deepEqual(await adapter.queueHealth!(config, signal), { ready: false });
  }
  readyBody = { status: "ready", accounts: 4 };
  queueReply = { status: 200, body: { tasks: [{ id: "ext-1", prompt: "secret" }] } };
  assert.deepEqual(await adapter.queueHealth!(config, signal), {
    ready: true,
    capacity: 4,
    maintenance: 0,
    tasks: [{ id: "ext-1" }],
  });
  for (const invalidCap of [null, "2.5", "", []]) {
    queueReply = { status: 200, body: { capacity: invalidCap, tasks: [{ id: "ext-1" }] } };
    assert.deepEqual(await adapter.queueHealth!(config, signal), {
      ready: true,
      capacity: 1,
      maintenance: 0,
      tasks: [],
    });
  }
```

并在 `tests/advanced/installed-packages.test.ts` 新增用例：安装 `plugins/muse/package/legacy-2.0.0.fmplugin.json`、创建 `concurrency: 3` 的连接并提交 1 个在途 `muse-video` 任务后，升级至 `plugins/muse/muse.fmplugin.json`（`2.1.0`），断言旧任务 `plugin_version === "2.0.0"` 正常排空完成、连接 `concurrency` 仍保持 `3`、新版本为 `"2.1.0"`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec tsx --test tests/advanced/sandbox-request.test.ts tests/advanced/installed-packages.test.ts`
Expected: FAIL（`legacy-2.0.0.fmplugin.json` 尚不存在，且 `/v1/queue` 404 时 `capacity` 为 `1` 而非 `4`）。

- [ ] **Step 3: 归档 `legacy-2.0.0.fmplugin.json` 并实现 `muse` `2.1.0` 容量回退与打包校验**

1. 将当前 `plugins/muse/muse.fmplugin.json` 原样复制为 `plugins/muse/package/legacy-2.0.0.fmplugin.json`。
2. 在 `scripts/build-studio-packages.mjs` 中新增对 `plugins/muse/package/legacy-2.0.0.fmplugin.json` 的 SHA-256 校验（`a332a61eb35e7d1f3dfb1070052a073e88729b0bf658d01da4665bbc097f7257`），并将 `id === "muse"` 的 `update.json` `notes` 更新为 `"支持按 Muse2API 启用账号数自动并发派发图片与视频任务"`。
3. 将 `plugins/muse/package/release.json` 的 `version` 与 `adapterVersion` 升至 `"2.1.0"`。
4. 在 `plugins/muse/package/policy.js` 中实现 `accountCapacity(accounts)`（正整数取 `Math.min(16, accounts)`，非空数组取 `Math.min(16, accounts.length)`，`true` 或非空普通对象取 `1`，其余返回 `0` 并判定 `{ ready: false }`）；在 `queueHealth(host)` 中：
   - 请求 `/v1/queue` 若状态码非 `2xx` 或 `text === null`，返回 `{ ready: true, capacity: fallbackCapacity, maintenance: 0, tasks: [] }`。
   - 若状态码为 `2xx`，解析 JSON：`q.capacity === undefined` 时使用 `fallbackCapacity`，否则使用 `Math.max(0, Math.min(16, healthInteger(q.capacity)))`；若 JSON 或字段校验抛错，落入 `catch` 返回 `{ ready: true, capacity: 1, maintenance: 0, tasks: [] }`。
5. 运行 `pnpm plugins:pack` 生成新版 `plugins/muse/muse.fmplugin.json` 与 `plugins/muse/update.json`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec tsx --test tests/advanced/sandbox-request.test.ts tests/advanced/installed-packages.test.ts tests/advanced/queue.test.ts`
Expected: PASS

- [ ] **Step 5: 提交 Task 1**

```bash
git add plugins/muse/package/legacy-2.0.0.fmplugin.json plugins/muse/package/policy.js plugins/muse/package/release.json plugins/muse/muse.fmplugin.json plugins/muse/update.json scripts/build-studio-packages.mjs tests/advanced/sandbox-request.test.ts tests/advanced/installed-packages.test.ts
git commit -m "feat(muse): 升级 2.1.0 支持按就绪账号数回退并发容量"
```

---

### Task 2: 容量型插件新建连接默认并发 `16` 及排队预估车道截断

**Files:**
- Modify: `packages/platform/src/platform.ts:489-605`
- Modify: `packages/platform/src/queue-snapshot.ts:37-96,211-230`
- Modify: `packages/original-api/src/estimate.ts:154-195`
- Test: `tests/advanced/queue.test.ts`

**Interfaces:**
- Consumes: `manifest.queue?.strategy` (`"slots" | "capacity" | "opaque" | undefined`)
- Produces:
  - `Platform.createConnection(user, value, studio)`：当 `value.concurrency === undefined` 时，若 `plugin.manifest.queue?.strategy === "capacity"` 默认写入 `16`，否则写入 `1`。
  - `ForecastCandidate["connection"]` 增加可选字段 `concurrency?: number`。
  - `QueueForecasts.read` 在构造 `QueueContext.health` 时，若 `typeof health.capacity === "number" && Number.isFinite(health.capacity)` 且 `typeof connection.concurrency === "number"`，将传入 `forecastQueue` 的 `health.capacity` 截断为 `Math.min(health.capacity, connection.concurrency)`。

- [ ] **Step 1: 在 `tests/advanced/queue.test.ts` 编写失败测试**

在 `tests/advanced/queue.test.ts` 新增测试 `"Muse 2.1 dispatches multi-account video jobs in parallel without /v1/queue and clamps forecasts to connection concurrency"`：
```ts
// 1. 安装 plugins/muse/muse.fmplugin.json (2.1.0)，模拟标准 muse2api：
//    GET /readyz -> { status: "ready", accounts: 3 }
//    GET /v1/models -> { data: [{ id: "muse-video" }] }
//    GET /v1/queue -> 404
//    POST /v1/videos -> 依次返回 task_1, task_2, task_3 (status: "queued")
// 2. 调用 createConnection 不传 concurrency，断言 studioConnections 返回 concurrency === 16；
//    对照普通插件（如 flow）不传 concurrency 时断言 concurrency === 1。
// 3. 连续提交 3 个 muse-video 任务，刷新 QueueHealthPoller 后并行执行 Executor：
//    断言 3 个 POST /v1/videos 全部并发发出（均处于 running 轮询态），第 4 个任务因 accounts=3 留在 queued。
// 4. 将连接 concurrency 调小为 2（updateConnection concurrency: 2）并刷新健康状态：
//    在已有 2 个 running 任务（带可预测时长历史样本）和 1 个 queued 任务时，
//    断言 QueueForecasts 与 OriginalEstimate 对第 3 个任务按 2 条车道计算等待时间（median > 0，而非按 3 账号误判空闲车道 median === 0）。
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec tsx --test tests/advanced/queue.test.ts`
Expected: FAIL（不传 `concurrency` 时创建的连接为 `1`，只能派发 1 个视频任务；调小 `concurrency` 后预测仍按 `health.capacity` 算车道）。

- [ ] **Step 3: 实现默认连接并发推导与预测快照车道截断**

1. 在 `packages/platform/src/platform.ts` 中：
   - `createConnection` 的输入 schema 将 `concurrency` 改为 `z.number().int().min(1).max(100).optional()`。
   - `createConnectionOn` 的 `input.concurrency` 类型改为 `number | undefined`，解析出 `plugin` 后取 `const concurrency = input.concurrency ?? (plugin.manifest.queue?.strategy === "capacity" ? 16 : 1)` 写入 `connections`。
2. 在 `packages/platform/src/queue-snapshot.ts` 中：
   - `SELECT id,plugin_id,plugin_version,enabled,revision,concurrency,queue_health,queue_health_revision FROM connections ...` 增加 `concurrency` 列。
   - `ForecastCandidate["connection"]` 增加 `concurrency?: number`。
   - 构造 `context.health` 时，若连接健康快照有效且 `typeof rawHealth.capacity === "number" && Number.isFinite(rawHealth.capacity) && typeof connection.concurrency === "number"`，传入 `{ ...rawHealth, capacity: Math.min(rawHealth.capacity, connection.concurrency) }`。
3. 在 `packages/original-api/src/estimate.ts` 中：
   - 第 156 行查询 `connections` 时增加 `c.concurrency` 字段，使估时候选连接同步应用 `connection.concurrency` 截断。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec tsx --test tests/advanced/queue.test.ts tests/advanced/muse-lifecycle.test.ts tests/advanced/original-generation.test.ts`
Expected: PASS

- [ ] **Step 5: 提交 Task 2**

```bash
git add packages/platform/src/platform.ts packages/platform/src/queue-snapshot.ts packages/original-api/src/estimate.ts tests/advanced/queue.test.ts
git commit -m "feat(platform): 容量型插件新建连接默认 16 并发并对齐排队预估车道"
```

---

### Task 3: 管理端插件列表暴露 `defaultConcurrency` 并同步新建服务表单默认值

**Files:**
- Modify: `packages/platform/src/studio-packages.ts:1128-1145`
- Modify: `apps/web/studio/settings-plugins-helpers.ts:16-20,119-141`
- Modify: `apps/web/studio/SettingsPlugins.tsx:70-82,152-156,304-325`
- Test: `tests/advanced/studio-plugin-packages.test.ts`

**Interfaces:**
- Consumes: `v.manifest->'queue'->>'strategy'` in `StudioPackages.list`
- Produces:
  - `StudioPackages.list(actor)` 每项新增 `defaultConcurrency: number`（`capacity` 策略为 `16`，其余为 `1`）。
  - `CAPACITY_SERVICE_CONCURRENCY = 16` 与 `defaultServiceConcurrency(plugin: { defaultConcurrency?: number }): number`（在 `apps/web/studio/settings-plugins-helpers.ts` 导出）。

- [ ] **Step 1: 在 `tests/advanced/studio-plugin-packages.test.ts` 编写失败测试**

在 `tests/advanced/studio-plugin-packages.test.ts` 中导入 `defaultServiceConcurrency`、`parseServiceConcurrency` 并断言：
```ts
// 1. 安装 muse.fmplugin.json 与 flow.fmplugin.json 后调用 packages.list(actor)：
//    断言 muse 条目的 defaultConcurrency === 16，flow 条目的 defaultConcurrency === 1。
// 2. 断言表单默认值计算：
//    - 新建 muse 服务（service === undefined）：defaultServiceConcurrency({ defaultConcurrency: 16 }) === 16，空输入 parseServiceConcurrency("", 16) === 16
//    - 新建普通服务（service === undefined）：defaultServiceConcurrency({ defaultConcurrency: 1 }) === 1
//    - 编辑已有存量 muse 服务（如 service.concurrency === 1 或 3）：service?.concurrency ?? defaultServiceConcurrency({ defaultConcurrency: 16 }) 严格保留 1 或 3。
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec tsx --test tests/advanced/studio-plugin-packages.test.ts`
Expected: FAIL（`defaultServiceConcurrency` 未导出，且 `packages.list` 未返回 `defaultConcurrency`）。

- [ ] **Step 3: 实现 `StudioPackages.list` 字段与 `SettingsPlugins.tsx` 表单默认值**

1. 在 `packages/platform/src/studio-packages.ts` 的 `list()` SQL 查询中新增：
   `CASE WHEN v.manifest->'queue'->>'strategy'='capacity' THEN 16 ELSE 1 END AS "defaultConcurrency"`。
2. 在 `apps/web/studio/settings-plugins-helpers.ts` 中新增导出：
   - `export const CAPACITY_SERVICE_CONCURRENCY = 16;`
   - `export function defaultServiceConcurrency(plugin: { defaultConcurrency?: number }): number`：当 `plugin.defaultConcurrency` 为 `1..100` 安全整数时返回该值，否则回退 `DEFAULT_SERVICE_CONCURRENCY`（`1`）。
3. 在 `apps/web/studio/SettingsPlugins.tsx` 中：
   - `type Plugin` 增加 `defaultConcurrency?: number;`。
   - `ServiceForm` 中计算 `const fallbackConcurrency = service?.concurrency ?? defaultServiceConcurrency(plugin);`，用于 `parseServiceConcurrency`、`defaultValue` 与 `placeholder`，并将字段提示文案中的默认说明改为动态显示 `（1–100 的整数，默认 ${defaultServiceConcurrency(plugin)}）`。

- [ ] **Step 4: 运行全套本地验证检查**

Run: `pnpm lint && pnpm typecheck && pnpm typecheck:web && pnpm test && pnpm build`
Expected: 全部 PASS（0 lint errors, 0 type errors, 全部测试通过，Next 生产构建通过）。

- [ ] **Step 5: 提交 Task 3**

```bash
git add packages/platform/src/studio-packages.ts apps/web/studio/settings-plugins-helpers.ts apps/web/studio/SettingsPlugins.tsx tests/advanced/studio-plugin-packages.test.ts
git commit -m "feat(studio): 插件管理新建 Muse 服务默认并行任务数同步为 16"
```
