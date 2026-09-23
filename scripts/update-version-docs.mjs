import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),c=require('../dist/capabilities.js');
const rows=c.entries.map(x=>`| ${x.id} | ${x.name} | ${x.status} | ${x.detail} |`).join('\n');
const text=`# ${c.title} V${c.version}

当前版本：${c.date}。能力目录以 [dist/capabilities.js](dist/capabilities.js) 为准；本文件由 node scripts/update-version-docs.mjs 生成。旧 V3.4 会议核对文件是历史记录。

公开入口：[演练与功能清单](https://irainzhang.github.io/jiaoying-ai/start.html) · [指挥台](https://irainzhang.github.io/jiaoying-ai/#command) · [现场端](https://irainzhang.github.io/jiaoying-ai/#field)。同一浏览器的两个标签页共享记录，不同设备、浏览器和隐私窗口不共享。业务内容保存在访客浏览器，不上传 GitHub。

本轮暂不接入 DeepSeek、Agent 与彩云实况。语音识别由浏览器提供，可能联网；字段整理使用规则，调度实际计算。公开预案是流程参考，非本系统官方授权或某条道路的安全批准。

## 三分钟演示

1. 同浏览器打开现场页，在“报情况”选择村庄与集合点，输入“新增12人，其中3人需协助，包含1名轮椅人员，可以分组”，下一步核对并确认。
2. 指挥台“核实情况”处理上报；待补信息持续保留。新的草案不会自动替换发布方案。
3. “安排转移”查看路线、逐车安排和未安排原因；详细基线、约束诊断按需展开，核对后确认发布。
4. “跟踪完成”登记联系并开始模拟执行。现场“我的任务”选择车辆，按当前下一步接收、联系、上车和到达；指挥台人工核验。
5. 现场“上报记录”查看核实结果，必要时更正。AI 对话固定在两端标题区，语音输入仍需核对后提交。
6. 在“更多资料”选择情景、天气演练、查看依据、评估、复盘报告和备份恢复。加载情景会替换当前演练，请先导出需要的记录。

V3.6 仅调整交互与视觉，沿用 V3.5 业务数据和本地启动程序；原有已提交演练不需要重置。

## 按优化清单对照

| 编号 | 项目 | 状态 | 完成内容与边界 |
|---|---|---|---|
${rows}

## 本地运行与发布

需要 Node.js 22 或更新版本，无 npm 依赖安装步骤。双击“启动V3.5演示.cmd”，默认端口 8769。或在本目录执行 node server.mjs，再打开 http://127.0.0.1:8769/start.html 。仅绑定本机，不对局域网开放。

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
