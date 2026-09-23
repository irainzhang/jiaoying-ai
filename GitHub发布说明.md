# GitHub 发布与维护

仓库：https://github.com/irainzhang/jiaoying-ai

在线入口：https://irainzhang.github.io/jiaoying-ai/start.html

源码保存在 `main`，Pages 使用 `gh-pages` 分支根目录。GitHub Pages 只提供静态托管，因此 V3.5.0 分享版在浏览器内运行相同的演练计算与约束校验。每位访客独立演练；同一浏览器的两个标签页共享 IndexedDB 记录，并通过标签页通知及时更新，不同设备不共享一场演练。

## 构建和检查

1. `node scripts/build-pages.mjs`。
2. `node --test tests/*.test.cjs tests/*.test.mjs`。
3. `node scripts/preview-pages.mjs`，在 `http://127.0.0.1:8768/jiaoying-ai/start.html` 检查实际仓库子路径，分别打开两个网页测试上报、核实回传和刷新恢复。
4. 按 `tmp/pages-manifest.json` 白名单发布 `tmp/pages-release`，不是原始 `dist`。保留地图来源、原始地理数据及 Leaflet 许可。
5. 更新源码 `main`、发布产物 `gh-pages` 后，等待 Pages 部署完成并验证线上版本、地图和双页联动。

## 发布边界

发布项目代码、Logo、演练示例、公开底图、功能范围清单与测试。真实 `.env`、密钥、日志、原始 PDF/Word、会议逐字稿、浏览器演练记录和本机运行快照均不发布。浏览器演练首次从合成初始数据创建，不读取发布者当前演练。

IndexedDB 保存不等于服务器备份；清理浏览器数据或隐私窗口关闭可能丢失记录。重要演练结果仍需导出。没有跨设备协作、账号权限、真实 Agent、彩云实况或真实应急通知。网页语音识别可能使用浏览器的在线服务，需按浏览器授权使用。

新版本地服务可使用 `启动V3.5演示.cmd`，监听 127.0.0.1:8769，不会因公开构建而重启或重置。

官方说明：https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
