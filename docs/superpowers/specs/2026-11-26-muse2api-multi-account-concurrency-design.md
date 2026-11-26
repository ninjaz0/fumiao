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
  - 发布 `muse` 插件 `2.1.0`：当 `/v1/queue` 可用时优先采用其返回的 `capacity` 与 `tasks`；当 `/v1/queue` 缺失（如 `404`）或未携带 `capacity` 字段时，回退采用 `/readyz` 返回的启用账号数作为 `capacity`（限制在 `1..16`）。
  - 对声明动态容量队列（`manifest.queue.strategy === "capacity"`，如 `muse`）的插件，在后端新建连接未显式指定 `concurrency` 时及前端新建服务表单中，默认「并行任务数量」设为 `16`（普通插件保持 `1`），同时完整保留管理员手动调小以适配上游服务器规格的能力。
  - 在 `QueueForecasts` 与估时候选连接中，将 `health.capacity` 按 `connection.concurrency` 取 `min`，使排队预估车道数与 `Executor` 实际并发放行上限一致。
- **非目标（Non-Goals）**
  - 不改动或强依赖上游 `muse2api` 仓库新增接口。
  - 不改变同一公开模型绑定唯一启用服务连接的路由契约（不做跨多条连接自动分流）。
- **反目标（Anti-Goals）**
  - 严禁原位修改已发布的 `muse` `1.x` 或 `2.0.0` 插件包内容及摘要，不得影响在途或历史任务恢复。
  - 不在插件升级时静默覆盖管理员已保存的存量连接 `concurrency`。
  - 若 `/v1/queue` 返回 `200` 但 `capacity` 字段格式非法（如 `null`、小数、空串），保持防御性回退 `1`，不放大异常状态下的并发。

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
  - `/readyz` 中 `accounts` 的解析规则：正整数直接取数值，数组取 `length`，其余真值取 `1`，统一截断至 `1..16`。
  - `StudioPackages.list` 向管理端暴露插件 `queueStrategy`（或 `defaultConcurrency`），驱动 `SettingsPlugins.tsx` 新建服务表单的默认值与字段说明文案。
  - `muse` `2.1.0` 的 `update.json` 更新说明文案及对应自动化测试覆盖（`2.0.0 -> 2.1.0` 升级排空、标准 `muse2api` 响应下多路 `muse-video` 并行派发、连接并发低于账号数时的预测车道截断）。
