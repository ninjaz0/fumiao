# Muse2API 多账号并发生成支持设计文档

- **日期**：2026-11-26
- **规模评估**：小规模改动（聚焦 `muse` 沙箱插件升级、连接默认并发策略与排队预估对齐）

## 1. 意图与背景（Intent & Why）

当上游 `muse2api` 账号池配置了多个启用账号时，其底层通过独立 Chromium `BrowserContext` 支持多账号并行生成视频与图片（最大并行度为 `min(启用账号数, MUSE2API_CONCURRENCY)`）。但当前弗淼（Fumiao）存在两处门控导致实际只能串行派发单任务：
1. `muse` `2.0.0` 插件的 `queueHealth` 在请求 `GET /v1/queue` 遇到标准 `muse2api` 返回 `404` 时，将 `capacity` 硬编码回退为 `1`（忽略了 `GET /readyz` 已返回的启用账号数 `accounts`）。
2. 新建服务连接时 `connections.concurrency`（「并行任务数量」）默认为 `1`，且排队预估（`QueueForecasts`）未按连接并发上限截断车道数。

本次改动在 `fumiao` 仓库内打通多账号并发链路，使画布多镜头批量出片、多候选生成与连续提交能够按上游可用账号数并行派发和接收。

## 2. 目标、非目标与反目标（Goals, Non-Goals & Anti-Goals）

- **目标（Goals）**
  - 发布 `muse` 插件 `2.1.0`：当 `/v1/queue` 可用时优先采用其返回的整数 `capacity` 与 `tasks`；仅当 `/v1/queue` 明确不存在（`404`）或 `2xx` 响应未携带 `capacity` 字段时，回退采用 `/readyz` 返回的启用账号数作为共享总 `capacity`（限制在 `1..16`），并在派发（`requestCapacity`）与排队预估（`queuePlan`）中对齐上游 `muse2api` 图片队列最多 8 路的接单限制，同时保留图片与视频共享的总容量。
  - 对声明动态容量队列（`manifest.queue.strategy === "capacity"`，如 `muse`）的插件，在后端新建连接未显式指定 `concurrency` 时及前端新建服务表单中，默认「并行任务数量」设为 `16`（普通插件保持 `1`），并在表单与 `update.json` 说明中明确提示实际生成并发同时受启用账号数、上游 `MUSE2API_CONCURRENCY` 与共享占用约束。
  - 在 `QueueForecasts` 与估时候选连接中，按各任务自身的 `plugin_version` 解析插件预测（升级后存量旧版本排队任务因缺少可信旧快照显示 `observing`），并在扣除外部与维护占用后按 `connection.concurrency` 截断有效并发车道。
- **非目标（Non-Goals）**
  - 不改动或强依赖上游 `muse2api` 仓库新增接口。
  - 不改变同一公开模型绑定唯一启用服务连接的路由契约（不做跨多条连接自动分流）。
- **反目标（Anti-Goals）**
  - 严禁原位修改已发布的 `muse` `1.x` 或 `2.0.0` 插件包内容及摘要，不得影响在途或历史任务恢复。
  - 不在插件升级时静默覆盖管理员已保存的存量连接 `concurrency`。
  - 若 `/v1/queue` 返回 `5xx`、`429`、`401/403`、传输超时（`status: 0`）或返回 `2xx` 但 `capacity`/`maintenance` 非整数（如 `null`、JSON 数值小数 `9.9`、字符串小数 `"2.5"`、空串），一律保持防御性单槽回退 `1`，绝不在缺失外部占用信息时放大并发。

## 3. 约束条件（Constraints）

- 必须将当前 `plugins/muse/muse.fmplugin.json` 归档为 `plugins/muse/package/legacy-2.0.0.fmplugin.json`，并在 `scripts/build-studio-packages.mjs` 中校验其 SHA-256 摘要，随后构建 `2.1.0` 版本与 `update.json`。
- 严格遵守 pnpm workspace 包边界（`apps/web` 不直接引入后端包），通过 `StudioPackages.list` 接口返回插件队列策略或默认并发元数据供设置页读取。
- 保持单次扣费、幂等提交（`Idempotency-Key`）与成品下载重试不重跑生成的既有契约不变。

## 4. 备选方案与选型（Approaches）

1. **方案 1（已选）：`/readyz` 账号数回退 + 容量型插件新建默认并发 `16` + 排队预测车道对齐**
   - 权衡：新连接零配置按账号数自动多并发，管理员仍可填更小值保护低配 `muse2api` 机器，且排队预估与实际派发完全一致；仅存量旧连接若此前保存为 `1` 需在后台手动调大一次。
2. **方案 2：在方案 1 基础上，升级插件时自动把存量连接的 `concurrency=1` 改写为 `16`**
   - 权衡：老连接升级零操作生效，但若管理员因 `muse2api` 机器内存或 `MUSE2API_CONCURRENCY` 限制而刻意保留 `1`，升级会静默突破其限流设置，故不采用。
3. **方案 3：在 `muse` 的 `configSchema` 中新增独立并发字段**
   - 权衡：与连接层自带的 `connections.concurrency` 职责重复，增加配置复杂度，故不采用。

## 5. 已确认决策与实现者职责（Decided & Left to Builder）

- **已与负责人确认的决策**
  - 仅在 `fumiao` 仓库内完成改造（方向 A），不要求改动上游 `muse2api`。
  - 采用方案 1：存量连接的 `concurrency` 不做静默自动改写。
- **留给实现者的具体细节（Builder's Calls）**
  - `/readyz` 中 `accounts` 的解析规则：正整数直接取数值，数组取 `length`，其余兼容真值（如 `"2"`、`true`、非空对象）取保守值 `1`，统一截断至 `1..16`。
  - 队列协议版本升级为 `manifest.queue.version = 2`（防止未升级宿主独立启用依赖 `tasks[].kind` 与 `QueueAdmission.job` 的包），同时在 `policy.js` 中对缺失 `job.kind` 或 `jobs[].kind` 的调用保留 8 路保守上限。
  - 外部任务图片槽位扣减与接口边界：当 `/v1/queue` 返回外部任务时，已知 `kind: "image"` 及缺少 `kind` 的外部任务均保守扣减 8 路图片上限，已知 `kind: "video"` 仅扣减共享总容量而不占用图片上限；当 `/v1/queue` 为 `404` 仅依赖 `/readyz` `accounts` 时，上游不暴露外部在途任务与 `MUSE2API_CONCURRENCY`，由连接并发说明引导管理员按共享负载配置。
  - `QueueForecasts` 与 `Executor` 同时以 `(plugin_version, canonical(config_snapshot))` 识别已变更的服务连接快照，按可接单同批候排任务独立规划，缺少可靠快照时显示 `observing`。
