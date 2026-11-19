# 工作台资源与接口清单

`production/static/` 提供工作台用到的 CSS、图标、头像、脚本和回退页面。资源读取器按 `production/manifest.json` 中的 `static/` 条目校验字节数和 SHA-256。

`contracts/routes.json` 记录 Studio HTTP 方法和路径。运行 `pnpm test:studio` 可在新版服务上检查路由、权限和停机响应。
