# Pure 独立仓库

本仓库 `https://github.com/ninjaz0/fumiao-aigc-pure` 源自完整项目的无 Lab 版本，默认分支为 `main`。包含 Lab 的完整项目保留在 [fumiao-aigc](https://github.com/ninjaz0/fumiao-aigc)。

移除的功能：

- 网站侧栏入口、静态页面与脚本、Notebook 嵌入及跨域运行代理。
- 项目持久化、文件同步、连接器下载／登记、HTTP 与 WebSocket 接口。
- Lab 数据库初始化、专用部署配置及专用测试。
- fmWorker 的“打开 Lab”入口及相关服务调用。

保留图片／视频／语音生成、对话、画布、素材包、资产、工作区、权限、积分、GPU 工作节点以及 Flow、Muse、Colab 接入。Colab 空实例只申请计算资源；H3 实例直接注册模型工作节点，安装原有执行器，通过模型节点心跳显示状态。释放时核对原 Google 账号及实例，H3 有任务运行时拒绝删除工作节点；不会释放其他实例。退出桌面仍不释放云端计算资源。

旧数据库中已有的 Lab 表、文件和云端实例不会由升级自动删除。若正在使用 Notebook，应先在完整版本保存文件和主动处理实例，再切换到本仓库；本仓库不提供旧 Notebook 的执行或同步界面。

本次仅将代码迁入独立 GitHub 仓库，不自动部署或改变正式站。需要完整版本时使用 [fumiao-aigc](https://github.com/ninjaz0/fumiao-aigc)；本仓库的 `main` 始终为 Pure 版本。密钥、数据库、用户素材与模型权重仍按既有规则排除。

## 验证

- fmWorker 后台：116 项隔离测试通过，覆盖账号隔离、分配结果不确定时的幂等重试、空实例不安装连接器、H3 独立引导、工作节点心跳、运行中任务阻止释放、已移除节点的重试和只释放选中实例。
- fmWorker 前端：30 项测试通过，TypeScript 与 Vite 生产构建通过。
- 平台：`pure_branch.py` 验证旧入口返回 404、新库不初始化 Lab 表、旧库不删数据、CSP/来源检查及普通创作接口；`acceptance.py`、`asset_packs.py`、`canvas_management.py` 与四组现有前端回归通过。
- 没有启动真实 GPU、购买 Colab 计算资源或部署正式站。
