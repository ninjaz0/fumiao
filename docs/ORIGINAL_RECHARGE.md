# 原版充值接口迁移

显式选择 `API_PROTOCOL=original` 时，NestJS 和 PostgreSQL 提供原版充值配置与列表、建单、详情、付款跳转、GET/POST 通知以及 `/payments/return`。`/studio` 默认连接原协议 Nest 后端。原协议使用本实例签发的会话、原工作区数字编号和原 `FM…` 订单编号。

- `GET /api/recharge` 返回启用通道、原兑换比例和按订单编号分页的本人订单。付款入口和详情还要求订单所属工作区的当前访问权限。浏览器返回页只负责导航。
- ZPay 和 EPusdt 适配器沿用原版签名、金额单位、回调确认及网关字段。建单按全局请求 UID 幂等，单个用户跨空间最多保留三笔待付订单。网关建单结果不明确时保留确认状态，重复提交同一 UID 不会重发。详情与后台核对共享限频。显式设置 `FUMIAO_PAYMENT_AUTOSTART=0` 可关闭定时核对。
- 通过独立的 Advanced 管理 API 调用 `PUT /api/admin/payments/:method`。该进程与原协议 Nest 实例使用同一个目标 PostgreSQL 和 `ENCRYPTION_KEY`，通过 `payment_channels` 共享加密通道配置。公开列表只返回通道标识和显示名称。对账和付款入口要求当前通道匹配订单的商户指纹。SQLite 导出不携带支付密钥。
- 结算对订单加锁，以 `(method, trade_id)` 约束交易号复用，并在同一事务内更新原工作区钱包、写入带 `recharge:<订单编号>` 的原格式账本和标记订单已支付。Advanced UUID 订单仍有自己的请求键和订单表。
- 新导入与数据库升级都会从归档恢复历史订单，包括公开编号、UID、归属、金额、时间和状态。升级不会重算余额或重写账本。已支付订单的有效回调重放保持幂等。导出仍要求先核对未完成订单。
- Next 原站模式将 `/api/recharge/*` 与 `/payments/return` 送往同一个原协议后端。将 Nest 的 `PUBLIC_URL` 设置为公开浏览器地址，网关通知及浏览器返回 URL 才会指向该站点。

## 隔离验证

`pnpm test:recharge` 需要 `TEST_DATABASE_URL` 指向临时 PostgreSQL 实例、已安装基线依赖的 `STUDIO_PYTHON` 和 `openssl`。脚本启动 pinned FastAPI、NestJS 和同机 HTTPS 网关，生成一次性的测试密钥和证书，对比两个 HTTP 服务的响应。覆盖两种签名协议、限频、回调解析、并发建单与结算、迟到回调、工作区权限、导入与升级、账本写入失败回滚，以及历史订单重放后的余额和账本。GitHub Actions 使用独立 PostgreSQL 服务运行此验证。

旧贡献入账按原金额留在历史账本。升级与历史核对范围见[贡献系统退役说明](FMWORKER_RESOURCES.md)。
