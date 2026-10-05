import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),c=require('../dist/capabilities.js');
const release=c.version;
const tableCell=value=>String(value).replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
const rows=c.entries.map(x=>`| ${[x.id,x.name,x.status,x.detail].map(tableCell).join(' | ')} |`).join('\n');
// Keep the current workflow and integration boundaries when regenerating README.
const text=`# ${c.title} V${c.version}

${c.date} 更新。V${release} 主线是 **录入需求 → 发布并执行 → 结束并留档**。指挥台只保留「需求录入」「任务执行」「任务记录」三个主区；现场端只保留「执行任务」「补报情况」两个主区。资料、资源与设置集中在二级入口，避免录入、地图和复盘互相挤占。

支持 Excel / CSV 名单、语音和文字，预览中集中补充协助与分组信息；位置不明的人员保留待办，不虚构路线。核实窗将上报人数与可补充字段分开显示，未知信息不默认填零。发布只需核对后点击，不要求手输姓名或指定确认文字；Guardian 的选填操作人默认记录为「演练值守」。

「任务执行」提供显眼的「结束当前任务」。只有全部人员核验完成且没有未决事项时才能按完成结束；也可提前结束，原样保留未完成状态。结束后两端停止修改；「开始新任务」自动归档旧场，可沿用地图或选择瑞安真实道路，并加载独立的 15 人演练底数。历史最多 10 场、合计 4 MB，满额会阻止新建，绝不自动删除历史；导出不会释放容量，本版尚无清理历史入口。详见 [V3.9 主线与任务结束](docs/V3.9主线与任务结束.md)。

地图附近增加模拟雨情卡，可切换 20 / 50 / 80 mm 最近 1 小时累计量，观察安排复核。演练等级不是官方预警，雨量变化不直接推断积水深度或自动封路。运输位置随现场回执更新；地图播放只是路线演示，不是真实 GPS，也不会代填上车或到达回执。后续天气事件方案见 [V3.8 天气与运输联动设计](docs/V3.8天气与运输联动设计.md)。

头部「城市韧性守护」保留为独立演练面板，与叫应主系统的数据、人数和发布结果仍未融合。面板顶部「自己接入 API」对应 \`dist/guardian/agent/api-config.js\`；默认离线，真实模型、真实天气与推荐的后端转发端点均未接通。将来接入时，真实密钥只放后端 \`.env\`。详见 [守护面板接入说明](docs/城市韧性守护接入与API配置.md)。

旧版缓存可通过 [安全更新页面](https://irainzhang.github.io/jiaoying-ai/update.html) 更新，演练记录与未提交草稿不会被清空。未上传文件不等于本场没有任务，地图转换前会列明保存的方案和执行状态。

公开入口：[演练与功能清单](https://irainzhang.github.io/jiaoying-ai/start.html?v=${release}) · [指挥台](https://irainzhang.github.io/jiaoying-ai/?v=${release}#command) · [现场执行端](https://irainzhang.github.io/jiaoying-ai/?v=${release}#field)。同一浏览器的两个标签页共享主系统记录，不同设备、浏览器和隐私窗口不共享。业务内容保存在访客浏览器，不上传 GitHub。

语音识别由浏览器提供，可能联网；字段整理使用规则，调度实际计算。公开预案是流程参考，非本系统官方授权或某条道路的安全批准。能力目录见 [dist/capabilities.js](dist/capabilities.js)。本文件由 \`node scripts/update-version-docs.mjs\` 生成，版本、能力表和运行限制与能力目录同步；较早会议核对与验收文件保留为历史记录。

## 三分钟演示

1. 在指挥台「需求录入」下载带定位列的模板，或上传 .xlsx / .csv 名单；也可语音或文字输入一批需求。仅使用演练人员信息。
2. 集中核对人数、协助与分组，按需展开定位地图；位置缺失的需求先保留待办。名单在浏览器内读取，有格式错误时整批不提交。
3. 进入「任务执行」，查看地图、逐车安排和未安排原因，核对后点击发布。生成草案不会自动替换正在执行的方案。
4. 同浏览器打开现场端「执行任务」，选择车辆，按下一步接收、联系、上车和到达；指挥台在同一「任务执行」页面看进度并核验到达。
5. 发现新增人员，在「补报情况」说“这里又发现3人，其中1人需要协助”。沿用当前接人点或已选位置，整理后一次确认整批补报。指挥台回到「需求录入」核实；未知特需保持待补，处理结果从记录入口查看。
6. 点击指挥台「结束当前任务」，核对完成与未完成摘要后结束。到「任务记录」查看结果并导出，需要再演示时点击「开始新任务」。AI 对话与独立守护面板仍可查看，均未连接大模型。

当前版本沿用批量建任务、定位与雨情视图，重点统一模块职责并补齐任务结束流程；本地需要启动当前后端，GitHub Pages 静态版可直接演练。名单基础格式见 [快捷建任务与现场执行](docs/V3.7快捷建任务与现场执行.md)，导航与结束按本页当前流程操作。

名单支持每人一行或按村汇总人数，每次最多 100 条；整场演练最多 500 名有效人员、200 个有效接送组。超限或任一行非法时整批拒绝。未提供的协助、轮椅人数不默认填零；没有姓名且人数为空时不自动按 1 人。

## 当前功能与边界

| 编号 | 项目 | 状态 | 完成内容与边界 |
|---|---|---|---|
${rows}

## 本地运行与发布

需要 Node.js 22 或更新版本，无 npm 依赖安装步骤。默认启动器名称仍为“启动V3.5演示.cmd”，默认端口 8769；在本目录执行 node server.mjs 也会读取当前后端代码。仅绑定本机，不对局域网开放。

已运行的旧 8769 服务不会因刷新网页而更新，也不会被自动停止或重置。地图定位、雨情和任务结束操作需要当前后端；旧服务仍运行时，请优先使用新版 GitHub Pages，或使用 JIAOYING_PORT 与 JIAOYING_PERSISTENCE_FILE 在独立端口、独立存档运行当前代码。正常停止旧服务后再启动也可，但应先导出演练记录。

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
