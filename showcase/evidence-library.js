(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.JiaoyingEvidence=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const reviewedAt='2026-09-23';
  const ruian='https://zjjcmspublic.oss-cn-hangzhou-zwynet-d01-a.internet.cloud.zj.gov.cn/jcms_files/jcms1/web2631/site/attach/0/ac7ddaa4aeda48e580d3bfb67bc548ed.pdf';
  const zhejiang='https://zjjcmspublic.oss-cn-hangzhou-zwynet-d01-a.internet.cloud.zj.gov.cn/jcms_files/jcms1/web3417/site/attach/0/e57f7d5cbb0444c59121d27f24ab8bc7.pdf';
  const repo='https://github.com/irainzhang/jiaoying-ai/blob/main/';
  const sources=[
    {id:'osm-geography',name:'瑞安市城区公开道路与地理要素',kind:'公开地理数据快照',publisher:'OpenStreetMap contributors；经 Overpass API 获取',url:'https://www.openstreetmap.org/copyright',access:'打开 assets/maps/query.overpassql，向 https://overpass-api.de/api/interpreter 提交公开查询；可直接查看仓库的 ruian-osm-raw.json 与 source-metadata.json。无需账号。',jurisdiction:'浙江省瑞安市城区局部：120.60—120.70°E、27.74—27.82°N；不是行政区边界',date:'数据基准 2026-09-22T08:45:51Z；获取 2026-09-22T12:50:33Z',license:'ODbL 1.0；保留 © OpenStreetMap contributors 署名与数据同许可要求',licenseUrl:'https://opendatacommons.org/licenses/odbl/1-0/',fields:['OSM id','WGS84 坐标','highway','name','oneway','waterway','natural','place'],use:'显示真实地理背景，为小片区道路计算提供原始几何和方向标签。',limitations:'公开许可不代表已通过赛事地图来源审核。道路现状、交通限制及灾情尚未核实；地图不能作为真实应急导航。',assets:['assets/maps/ruian-osm-raw.json','assets/maps/ruian-urban.geojson','assets/maps/query.overpassql','assets/maps/source-metadata.json'],synthetic:false,contestApproval:'待组委会确认'},
    {id:'routing-model',name:'瑞安小片区道路计算图与演练通行参数',kind:'公开数据派生＋演练假设',publisher:'本项目，基于 OpenStreetMap',url:repo+'dist/assets/maps/ruian-routing.json',access:'读取公开仓库的 ruian-routing.json；按 scripts/build-road-network.py 从保存的原始 OSM 响应重新生成。生成规则以仓库实际脚本与元数据为准。',jurisdiction:'瑞安市城区选取的连通道路片区',date:'V3.5；原始数据时间同 OSM 目录',license:'派生道路数据库沿用 ODbL 1.0；算法与业务演练参数的独立许可尚未单列',licenseUrl:'https://opendatacommons.org/licenses/odbl/1-0/',fields:['节点及 OSM 来源','路段几何','方向','长度','演练分钟数','演练开放状态'],use:'最短路、可达性、封闭路段后的重新计算及路线展示。',limitations:'仅有限连通图；不包含完整限高限重、转向限制、临时管制和实时路况。长度来自坐标，通行时间与封路事件是演练假设。',assets:['assets/maps/ruian-routing.json'],synthetic:'mixed',contestApproval:'待组委会确认'},
    {id:'synthetic-exercise',name:'公开合成人员、车辆、接收点与事件情景',kind:'合成演练数据',publisher:'本项目',url:repo+'exercise.cjs',access:'从公开源码的 initial()、情景目录及 geo-scenario.cjs 读取；加载场景后可导出本场 JSON。初始样例为 6 组 15 人、3 辆车、2 个接收点。',jurisdiction:'以瑞安为演示背景；无真实居民或机构资源台账',date:'V3.5 固定情景；交互事件时间为操作时间',license:'公开读取；团队尚未单独声明业务样例的再分发许可，参赛使用说明待团队确认',fields:['人数','明确上报的协助/轮椅需求','同行分组','车辆座位与适配能力','接收容量','事件状态'],use:'展示上报、核实、约束计算、执行反馈和可复现对照。',limitations:'集合点及接收点用途是演练设定，不能据道路坐标认定为正式安置场所；不包含真实灾情或真实救助成效。',assets:[],synthetic:true,contestApproval:'合成样例作为参赛数据的使用方式待组委会确认'},
    {id:'rule-tools',name:'规则整理与可复跑调度工具',kind:'项目实现与声明式规则',publisher:'本项目',url:repo+'exercise.cjs',access:'公开读取 exercise.cjs、resilience.cjs、dispatch-large.cjs、dist/village-assistant.js、dist/field-assistant.js 和 tests；按 README 运行验证。',jurisdiction:'本演练配置',date:'算法标识随方案与报告记录',license:'仓库公开可查看；应用代码尚未单列开源许可证，依赖按各自许可保留',fields:['输入版本','执行版本','约束','优化结果','规则基线','计算耗时','失败原因'],use:'字段整理、路线与车辆分配、同输入基线比较和结果校验。',limitations:'当前无大模型或 Agent 调用。基线是公开声明的模拟派车规则，不是对真实人工指挥表现的测量；求解收益不能称为 AI 独立效果。',assets:[],synthetic:false},
    {id:'speech-input',name:'浏览器语音识别与现场确认输入',kind:'交互演练输入',publisher:'使用者；识别服务由浏览器提供',url:repo+'dist/voice-input.js',access:'在支持的浏览器中点击语音输入并授权麦克风；识别文字可编辑，确认后才提交。也可使用公开示例文本。',jurisdiction:'当前浏览器演练',date:'每次输入/确认时间随记录保存',license:'输入者应使用有权提供的内容；浏览器识别服务遵循其自身条款',fields:['识别文字','人工更正字段','确认时间','村级批次','处理回执'],use:'减少现场录入步骤，同时保留原话和人工核对。',limitations:'应用未编写音频录制或存储逻辑；浏览器识别可能调用在线服务。确认后的文字可能进入演练记录和导出文件，分享时只使用合成示例。',assets:[],synthetic:'user-input'},
    {id:'exercise-weather',name:'演练天气序列与彩云接口契约',kind:'演练输入；实况未连接',publisher:'本项目；后续实况拟由彩云天气提供',url:repo+'integrations.mjs',access:'通过演练天气操作读取设定值；integrations.mjs 提供请求和归一化契约，本版本不发送彩云请求。',jurisdiction:'当前演练地点',date:'演练更新时间，非真实观测时间',license:'演练参数由项目提供；未来实况使用须另行遵循服务许可及凭证配置',fields:['sourceMode','降水数值','单位','累计时间窗','更新时间','状态'],use:'可重复触发演练条件变化；为后续实况显示预留来源、时间和过期判断。',limitations:'毫米累计量与毫米/小时强度分开；雨量不能直接当作积水深度、确定封路或受灾人数。',assets:[],synthetic:true},
    {id:'policy-ruian',name:'瑞安市防汛防台抗旱应急预案',kind:'公开政府文件',publisher:'瑞安市人民政府办公室',url:ruian,access:'政府政务公开附件可直接下载 PDF，无需账号；按文号和页码核验。',jurisdiction:'浙江省瑞安市行政区域',date:'2023-10-17',license:'政府公开文件；本项目仅提供出处、条款定位和简短转述，未另行声明开放许可',fields:['文号','发布机构','成文日期','条款编号','适用地域'],use:'人员转移、路段管控和持续报送的流程参考。',limitations:'本次核实的是公开文本；尚未取得主管部门对当前有效版本及项目适用性的确认。不能据此批准具体路线、容量或算法权重。',assets:[],synthetic:false},
    {id:'policy-zhejiang',name:'浙江省防汛防台抗旱应急预案',kind:'公开政府文件',publisher:'浙江省人民政府防汛防台抗旱指挥部',url:zhejiang,access:'浙江省应急管理厅对应政务公开附件可直接下载 PDF，无需账号；按浙防指〔2024〕4号与页码核验。',jurisdiction:'浙江省行政区域',date:'2024-07-22',license:'政府公开文件；本项目仅提供出处、条款定位和简短转述，未另行声明开放许可',fields:['文号','发布机构','成文日期','条款编号','适用地域'],use:'基层职责、预警叫应及落实情况反馈的流程参考。',limitations:'公开文本已核读，后续修订和实际业务授权仍须核实；不代表政府对本项目或生成方案的认可。',assets:[],synthetic:false}
  ];
  const ruianBase={title:'瑞安市防汛防台抗旱应急预案',publisher:'瑞安市人民政府办公室',date:'2023-10-17',version:'瑞政办〔2023〕95号',jurisdiction:'瑞安市行政区域',sourceId:'policy-ruian',status:'公开原文已核读；现行版本待主管部门复核'};
  const zhejiangBase={title:'浙江省防汛防台抗旱应急预案',publisher:'浙江省人民政府防汛防台抗旱指挥部',date:'2024-07-22',version:'浙防指〔2024〕4号',jurisdiction:'浙江省行政区域（含瑞安）',sourceId:'policy-zhejiang',status:'公开原文已核读；现行版本待主管部门复核'};
  const policies=[
    {...zhejiangBase,id:'policy-closed-loop',section:'4.2.3 闭环反馈',page:19,url:zhejiang+'#page=19',summary:'收到叫应信息的单位和责任人，应按相关规则反馈管控措施落实情况。',application:'本项目据此细分收到、联系、上车、到达和核验；界面状态划分是项目设计。',boundary:'该条款没有规定本系统的按钮、默认时限或自动结案规则。',tags:['叫应','反馈','核验','待办']},
    {...zhejiangBase,id:'policy-responsibility',section:'2.3 基层防汛防台抗旱组织',page:14,url:zhejiang+'#page=14',summary:'基层组织应明确职责、分工和人员，并落实区域责任及包保责任。',application:'待办记录责任角色、处理人和回执，用于演练责任跟踪。',boundary:'演练负责人和时限由使用者填写，不是对真实干部职责的分配。',tags:['责任','联系','待办']},
    {...ruianBase,id:'policy-transfer',section:'5.3.4 城市内涝（1）—（3）',page:35,url:ruian+'#page=35',summary:'关注易涝部位，针对危险区域和路段采取管控措施，并组织危险区域人员转移。',application:'已核实道路事件改变可通行图，系统重新计算建议并保留人工确认。',boundary:'本条不提供具体安全路线、车速、接收点名单或调度评分权重。',tags:['道路','封路','转移','调度']},
    {...ruianBase,id:'policy-reporting',section:'5.5 信息报送',page:37,url:ruian+'#page=37',summary:'防御工作需持续报送；险情灾情和处置变化应及时续报，直至险情排除或灾情稳定、结束。',application:'事件保留状态变化和未解决事项，导出时区分草案、执行和核验记录。',boundary:'演练导出不替代正式信息报送；页面提示时限不是法定报送时限。',tags:['报告','反馈','事件','复盘']}
  ];
  const limits=[
    {id:'ai',label:'AI / Agent',status:'未接入',detail:'当前为规则整理与实际算法计算，接口预留。不会产生模型调用记录或 AI 效果指标。'},
    {id:'weather',label:'彩云天气',status:'准备完成、未连接',detail:'天气显示演练来源；真实观测、实时交通、GPS 均未接入。'},
    {id:'map-review',label:'赛事地图要求',status:'待组委会确认',detail:'OSM 开放许可不等于赛事所要求的已审核地图来源。正式材料使用前应核实来源资格。'},
    {id:'synthetic-review',label:'合成情景参赛使用',status:'待组委会确认',detail:'公开生成规则和样例，明确为合成数据；其参赛使用方式仍需确认。'},
    {id:'policies',label:'预案依据',status:'2 份公开文本、4 张流程卡',detail:'条款用于解释流程，不验证具体路线安全，也不等于政府授权；未匹配条款时显示“未检索到匹配依据”。'},
    {id:'sync',label:'多人协作',status:'公开版同浏览器联动',detail:'不同设备各自保存演练；跨设备共享房间和账号后端尚未部署。'},
    {id:'effect',label:'效果证据',status:'演练结果',detail:'同条件基线可以复跑，但不能推断真实救助效果、减少伤亡或模型独立贡献。'}
  ];
  const submissionChecklist=[
    {id:'ppt',label:'解释方案的 PPT',status:'待制作',detail:'应包含问题、SDGs、应用场景、公开数据、Agent 设计、技术路线与价值；当前仅提供讲解结构。',source:'比赛手册 PDF 第4页'},
    {id:'video',label:'8—10 分钟讲解视频',status:'待录制',detail:'正文要求不超过10分钟，评分表对不足8分钟或超过12分钟扣分；建议控制为8—10分钟。',source:'比赛手册 PDF 第4、6页'},
    {id:'code',label:'源码及环境说明 / 可访问链接',status:'随版本发布核验',detail:'以当前 README、可运行源码、依赖许可、公开页面和验证记录为准；当前链接是规则与调度原型，尚非已接入模型的智能体。',source:'比赛手册 PDF 第4、8页'},
    {id:'promise',label:'手写签名承诺书扫描件',status:'需团队完成',detail:'由团队成员填写签名材料；承诺书和证件信息不上传公开 GitHub。',source:'比赛手册 PDF 第8、14—15页'},
    {id:'anonymous',label:'匿名展示复核',status:'待最终材料核验',detail:'PPT、视频不含成员单位或个人信息；检查录屏账号、通知、浏览器栏、文件作者和声音自我介绍；公开仓库账号如何处理需向组委会确认。',source:'比赛手册 PDF 第8页'},
    {id:'source-review',label:'数据、地图及原创关系说明',status:'目录已准备，资格待确认',detail:'保留来源机构与获取方式；向组委会核实地图及合成样例；说明原“叫应”仅有公开报道，本项目没有其源码、接口或官方授权。',source:'比赛手册 PDF 第3—5页'},
    {id:'package',label:'按规则命名与提交',status:'需团队最终提交',detail:'ZIP 名称为“数字标识码-团队名称-参赛作品名称”。所提供手册写明2026年10月10日18时截止；以组委会后续通知复核。',source:'比赛手册 PDF 第8页'}
  ];
  const presentation=[
    {time:'00:00—00:45',title:'问题和定位',content:'说明基层叫应场景中的任务：谁还未联系、谁需协助、哪里受阻、是否已核验。定位为可核实的人员转移协同原型。'},
    {time:'00:45—01:20',title:'SDGs 与价值边界',content:'关联 SDG 11.5 和13.1，展示需求覆盖、等待和未解决事项等过程指标，不宣称已经减少伤亡。'},
    {time:'01:20—02:00',title:'数据与架构',content:'区分 OSM 道路、合成人员资源、公开流程预案和演练天气。说明浏览器语音、规则整理、计算工具、人工确认；模型/Agent 均未连接。'},
    {time:'02:00—03:15',title:'双端上报',content:'加载演练，现场输入新增12人、其中3人需协助且含1名轮椅人员；核对人数口径与原话，确认提交，在同一浏览器的指挥台核实。'},
    {time:'03:15—04:30',title:'约束与基线',content:'查看同快照的车辆、接收点分配、协助需求等待和未安排原因；数据和约束不变，不预写算法提升百分比。'},
    {time:'04:30—05:45',title:'失效与重新计算',content:'演示道路或资源失效，查看受影响任务和新草案。说明已上车对象约束、尚存缺口和需人工协调的资源。'},
    {time:'05:45—06:45',title:'人工确认和现场反馈',content:'核对并确认可执行草案，展示接收、联系、上车、到达和核验的差别；未解决事项继续保留在待办。'},
    {time:'06:45—07:45',title:'证据和复盘',content:'打开预案条款及数据目录，导出报告与 JSON，展示输入版本、处理回执、同条件对照及恢复。'},
    {time:'07:45—08:45',title:'验证、局限与下一步',content:'给出本版本实际测试与情景结果，不报未测数字。说明模型、实况及跨设备服务待接入，并交代正式业务和赛事来源核验。'}
  ];
  return {version:'3.5',reviewedAt,sources,policies,limits,submissionChecklist,presentation,
    noMatch:'未检索到匹配依据；可查看公开预案目录，不据此推断具体路线安全。',
    sdgs:[{target:'11.5',url:'https://sdgs.un.org/goals/goal11',application:'关注灾害影响与处于脆弱处境人群的保护。'},{target:'13.1',url:'https://sdgs.un.org/goals/goal13',application:'通过准备、反馈和演练提升应对气候相关灾害的韧性。'}]};
});
