# 城市韧性守护：独立面板与 API 接入

2026-10-04。本轮在叫应 V3.7 头部新增「城市韧性守护」入口，使用全屏浮层展示独立瑞安合成演练。原「AI 对话」、指挥和现场任务继续沿用原有逻辑。守护面板的模拟发布只生成自己的演练结果和通知文本，不写入叫应任务，不向外部通讯工具发送消息。

## 你要接 API 的位置

在浮层顶部点击 **「自己接入 API」** 可随时查看说明。唯一需要填写的前端配置文件是：

`dist/guardian/agent/api-config.js`

文件顶部有说明，按三段组织：① 大模型；② 可选天气配置；③ 运行策略。默认 `provider: 'offline'`、`allowNetwork: false`，无需密钥即可使用本地工具、摘要检索及演练流程。离线规则理解不能当作大模型能力或真实模型调用效果。

## 推荐方式 A：本机后端代理

本轮按约定只预留配置，**没有实现转发端点**。将来由后端增加 OpenAI Chat Completions 兼容转发端点，例如 `POST /api/v3/agent/chat`，从 `.env` 读取：

```dotenv
JIAOYING_AI_BASE_URL=https://api.deepseek.com
JIAOYING_AI_MODEL=账号当前可用的模型名称
JIAOYING_AI_KEY=只在本机填写的访问密钥
```

后端就绪以后，在前述文件的 `llm` 段修改这三项，其余保留：

```javascript
provider: 'local-gateway',
gatewayUrl: 'http://127.0.0.1:8769/api/v3/agent/chat',
allowNetwork: true,
```

`gatewayUrl` 填后端实际完整地址，不会再自动追加路径；8769 只是当前启动器默认端口，以实际服务输出为准。代理模式不发送前端 API Key，模型名称可以由后端 `.env` 指定。只填写这些字段不等于后端已经实现，也不等于已经连接到真实模型。

若后端只接受回环来源，应从本机后端提供的同源页面使用。公开 GitHub HTTPS 网页不能直接当作本地同源页面；连接回环 HTTP 还受浏览器本地网络、混合内容和跨域限制。跨设备在线接入需另建有鉴权、限流和来源限制的 HTTPS 服务，不在本轮范围内。

## 方式 B 与天气密钥

`openai-compatible` 模式需填写 `baseUrl`、`apiKey`、`model` 并显式打开 `allowNetwork`；`baseUrl` 不带 `/chat/completions`。只适用于个人电脑上的临时演示，**不能把填了密钥的文件发布到 GitHub**。GitHub Pages 上任何人都能读取前端源码，泄露的密钥可能被盗用并消耗额度。

天气段同样不得发布真实 `caiyunToken` 或 `tencentKey`。本轮天气仍为合成演练口播雨量，天气字段是预留配置，不表示已完成真实天气取数；实时降水强度 mm/h 不能直接写入累计雨量 mm。

配置仅表示计划使用的路径，首次真实请求成功后才能确认已接通。在线请求失败时显示离线回落、留存轨迹，明确「本次任务理解不是大模型完成的」。本轮自动验证使用受控响应与错误替身，不使用真实模型账号。

## 人工确认与数据边界

- 发布需弹出人工确认框并填写确认人；空白或空格不能确认。模型和宿主消息都不能自动批准。
- 确认依据发生变化后必须重新核对，不沿用旧方案批准。
- 人员、容量、车速、网格与路网为独立合成底数；不得与叫应当前演练的人数相加或混称同步。
- 不预测水深；计算收益属于本地算法，不归因为尚未连接的大模型。
- 资源不足时保留未安排人员与原因。预案检索展示「公开文件概括性摘要，不是原文」。

## 离线使用和发布

本地直接双击 `dist/guardian/agent/index.html` 或 `embed.html` 可运行，无服务器和 CDN 依赖，经典脚本加载方式保留。

公开网页需要先联网完成离线缓存。浮层显示 **守护面板已缓存，可断网刷新** 后，可断网刷新当前站点继续演示；从未打开过的网站不能在完全断网时首次下载。在线模型、真实天气、在线地图瓦片及外链仍需网络。缓存只包含同站点公开静态文件，不缓存 `/api/` 或模型请求；前端配置文件本身属于公开静态文件，不能填写真实密钥。新版后台缓存完成后，下一次刷新使用新版。

构建使用 `node scripts/build-pages.mjs`。发布包来自 `tmp/pages-release` 和 `tmp/pages-manifest.json` 白名单，实际发布到 `gh-pages`，并非直接以源码 `dist/` 上线。`guardian-cache-manifest.json` 与离线 worker 的缓存版本由当前文件内容生成。不要直接上传本机草稿、测试产物、会议稿或 `.env`。

技能或知识库 Markdown 修改后运行 `node scripts/build-guardian-bundles.mjs`，再构建发布。

## 可复现检查

```text
node tests/guardian/run-tests.mjs
node --test tests/guardian-*.test.mjs tests/pages-build.test.mjs
```

原 ZIP 的实际基线是 78 项测试，不是任务描述中的 82 项版本。本轮补齐配置、代理适配、运行路径和确认保护后，以实际执行结果为准；测试报告保存在 `tmp/guardian-tests`。代码中不保存真实密钥，真实服务端到端验证需要后续提供已部署的代理服务。
