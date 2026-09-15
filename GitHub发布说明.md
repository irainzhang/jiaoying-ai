# GitHub 发布与维护

项目代码位于 `main` 分支。静态演示仅需要 `dist` 内的 HTML、CSS、JavaScript、Logo 和 `.nojekyll`，不需要安装依赖或构建。

## Pages 发布方式

发布分支使用 `gh-pages`，根目录内容对应 `main` 分支的 `dist`。在仓库的 Settings → Pages 中，Source 选择 Deploy from a branch，Branch 选择 `gh-pages`，目录选择 `/ (root)`，保存后等待 GitHub 完成部署。

更新代码后，把新的 `dist` 内容发布到 `gh-pages`。源码中的资源引用采用相对路径，模块采用 hash 导航，支持仓库子路径访问；不要把包含本机服务和配置的完整源码作为 Pages 静态目录。

上述设置方式见 [GitHub 官方 Pages 发布说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

## 本地验证

```text
node --test tests/engine.test.cjs tests/state.test.cjs tests/assistant.test.cjs tests/gateway.test.mjs tests/assistant-ui.test.cjs
node examples/replay.cjs examples/default-exercise.json
node server.mjs
```

在线版运行虚构演练和本地规则导览。DeepSeek 网关仅在本机服务环境探测；真实接口接入步骤见 `AI接入说明.md`。

## 仓库内容

发布代码、Logo、说明、测试、默认虚构情景及复现脚本。`.env.example` 是不含密钥的配置模板；真实 `.env`、运行日志、编辑器运行配置、临时文件以及项目原始 PDF、Word 不在发布范围。

本文件是部署操作说明；是否发布成功应以仓库记录、Pages 状态和实际访问结果为准。
