import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),c=require('../dist/capabilities.js');
const rows=c.entries.map(x=>`| ${x.id} | ${x.name} | ${x.status} | ${x.detail} |`).join('\n');
const text=`# ${c.title} V${c.version}

当前版本：${c.date}。能力目录以 [dist/capabilities.js](dist/capabilities.js) 为准；本文件由 node scripts/update-version-docs.mjs 生成。旧 V3.4 会议核对文件是历史记录。

公开入口：[演练与功能清单](https://irainzhang.github.io/jiaoying-ai/start.html?v=3.7) · [指挥台](https://irainzhang.github.io/jiaoying-ai/?v=3.7#command) · [现场执行端](https://irainzhang.github.io/jiaoying-ai/?v=3.7#field)。同一浏览器的两个标签页共享记录，不同设备、浏览器和隐私窗口不共享。业务内容保存在访客浏览器，不上传 GitHub。

本轮暂不接入 DeepSeek、Agent 与彩云实况。语音识别由浏览器提供，可能联网；字段整理使用规则，调度实际计算。公开预案是流程参考，非本系统官方授权或某条道路的安全批准。

## 三分钟演示

1. 指挥台“快捷建任务”下载当前村庄的 CSV 模板，或选择 .xlsx / .csv 名单；也可语音或文字输入“演示村 A，在村委会集合点，新增6人，其中1人需协助，轮椅0人，可以分组”。
2. 集中核对每条需求，确认这批需求并生成安排。名单在浏览器内读取；有格式错误时整批不提交，缺失的接送信息保留待补。只使用模拟姓名。
3. “安排转移”查看路线、逐车安排和未安排原因，核对后人工确认模拟发布。生成草案不会自动替换正在执行的方案。
4. 同浏览器打开现场执行端。“当前任务”选择车辆，按当前下一步接收、联系、上车和到达；指挥台“跟踪完成”查看变化并人工核验到达。
5. 执行中发现新增人员，在“快速补报”入口说“这里又发现3人，其中1人需要协助”。沿用当前任务接人点或一次选定的位置，整理后一次确认整批补报。指挥台收到待核实记录，未知特需保持待补。
6. “提交记录”看处理结果；总量、更正和其他现场情况仍保留。AI 对话固定在两端标题区，仍未连接大模型。“更多资料”提供情景、天气演练、依据、评估、复盘和备份，加载情景前先导出需要的记录。

V3.7 新增指挥批量建任务能力，本地需启动 V3.7 后端；GitHub Pages 新静态版可直接演练。原有状态格式兼容，不需要重置演练。详细格式、操作与边界见 [V3.7 快捷建任务与现场执行](docs/V3.7快捷建任务与现场执行.md)。

名单支持每人一行或按村汇总人数，每次最多 100 条；整场演练最多 500 名有效人员、200 个有效接送组。超限或任一行非法时整批拒绝。未提供的协助、轮椅人数不默认填零；没有姓名且人数为空时不自动按 1 人。

## 按优化清单对照

| 编号 | 项目 | 状态 | 完成内容与边界 |
|---|---|---|---|
${rows}

## 本地运行与发布

需要 Node.js 22 或更新版本，无 npm 依赖安装步骤。默认启动器名称仍为“启动V3.5演示.cmd”，默认端口 8769；在本目录执行 node server.mjs 也会读取当前后端代码。仅绑定本机，不对局域网开放。

已运行的旧 8769 服务不会因刷新网页而更新，也不会被自动停止或重置。批量建任务要求服务提供 V3.7 能力；旧服务仍运行时，请优先使用新版 GitHub Pages，或使用 JIAOYING_PORT 与 JIAOYING_PERSISTENCE_FILE 在独立端口、独立存档运行当前代码。正常停止旧服务后再启动也可，但应先导出演练记录。

已提交状态自动保存在 tmp/local-state-v35.json，写盘成功后才返回成功。损坏存档不会被自动覆盖。JIAOYING_PORT 可换端口；JIAOYING_PERSISTENCE_FILE 可指定独立存档；JIAOYING_STATE_FILE 仅用于显式初始化/迁移，常规启动不应反复指定旧快照。

GitHub Pages 需要执行 node scripts/build-pages.mjs，并按 tmp/pages-manifest.json 白名单发布 tmp/pages-release。不要直接上传 dist，不要发布 tmp、会议逐字稿、.env、密钥或运行中演练。构建复用本地业务模块，公开版通过 IndexedDB 事务持久化，BroadcastChannel 通知与轮询联动。

验证：node --test tests/*.test.cjs tests/*.test.mjs 。评估：node scripts/evaluate-scenarios.cjs，结果见 dist/assets/evaluation.json。道路配置可用 Python 3 运行 scripts/build-road-network.py 重建（只用已保存的 OSM 原始数据，不联网）。

## 数据、评估和范围

真实路网为瑞安局部101节点、138路段，保留单向性和原始道路几何。点位用途、人员、容量、通行速度和开闭状态仍为演练设定；不包含完整交通限制或实时灾情。地图资格与合成数据参赛用法仍需向组委会确认。

来源见 [地图说明](dist/assets/maps/SOURCES.md) 与 [公开证据库](dist/evidence-library.js)。© OpenStreetMap contributors，ODbL 1.0；Leaflet BSD-2-Clause 许可保留在 dist/vendor/leaflet/LICENSE。应用代码未另行指定开源许可证，公开可查看不等于额外授予许可。

固定评估包括六类情景与20/60组规模样例，使用相同输入和约束，保留未安排与失败例。运行时间属于测量环境，不代表所有浏览器性能；算法收益不能归因于未接入的大模型。

${c.limits.map(x=>'- '+x).join('\n')}

[参赛材料与8分45秒讲解脚本](docs/V3.5数据与参赛准备.md) 已准备。最终 PPT、实录视频与本人签名承诺书仍需定版制作/签署，不能以网页原型冒充真实模型调用。跨设备房间、真实天气、GPS、多趟和换车尚未部署。
`;
await writeFile(new URL('../README.md',import.meta.url),text,'utf8');
