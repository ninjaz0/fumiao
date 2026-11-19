# 平台执行器源码快照

此目录提供客户端构建所需的 H3/Breeze 执行器、模型定义和 Flow 模型目录。模型权重不在仓库中。

`scripts/prepare_assets.py` 默认从此目录生成可复现的运行包；`resources/agent.lock.json` 记录各文件哈希。与主平台联调时可设置 `FMWORKER_PLATFORM_SOURCE` 指向完整平台工作区，构建时使用该工作区的执行器版本。

保留源文件内的授权声明；模型和第三方组件的使用条件见根目录 `NOTICE`。
