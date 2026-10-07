/*!
 * 城市韧性守护 Agent · 区域与口径配置
 * ---------------------------------------------------------------
 * 这是整个系统唯一的「区域/口径」配置入口。
 * 演示时如需更换区域，只改本文件，不要改工具代码。
 *
 * 合规与边界（务必保留）：
 *   1. 本文件中的高程、不透水面、历史易涝次数、人口结构、可达时间等数值
 *      均为「演练设定值」，来自合成拓扑，不是真实统计数据。
 *   2. 区域名称与河流走向仅作为演练背景，不对任何真实社区作风险断言。
 *   3. 对外统一表述为「积水易发风险」，不使用「精确内涝水深预测」。
 *   4. 地图展示须使用合规底图与数据来源；本演示不加载任何在线底图。
 */
(function (FA) {
  'use strict';

  FA.data = FA.data || {};

  FA.data.region = {
    /* ---------- 标识 ---------- */
    id: 'ruian-exercise',
    name: '瑞安市（演练背景）',
    shortName: '瑞安',
    subtitle: '暴雨洪涝 · 脆弱人群优先的应急资源调度演练',

    /* ---------- 口径 ---------- */
    // 数据类型：synthetic-topology = 合成拓扑；任何真实数据接入后必须同步修改
    dataMode: 'synthetic-topology',
    dataModeLabel: '合成业务演练数据',
    spatialScale: 'community',           // community | street | grid
    spatialScaleLabel: '社区 / 村级',
    riskTerminology: '积水易发风险',      // 对外统一表述
    timezone: 'Asia/Shanghai',

    /* ---------- 演示边界 ---------- */
    demo: {
      scenarioRainfallMm: 120,           // 明星 Demo 口播雨量
      scenarioHorizonHours: 6,
      scenarioStepsMm: [80, 120, 160],   // 情景推演三档
      triggerCheckIntervalMs: 1000,      // 口播模拟的检查节拍
      defaultRainfallMm: 35,             // 初始实况
      rainfallStepMm: 20                 // 每次口播增量
    },

    /* ---------- 数据来源声明（RAG 与报告引用同一份）---------- */
    dataProvenance: [
      { category: '气象 / 降雨', purpose: '暴雨风险输入、情景设定', source: '彩云天气免费版 或 腾讯位置服务免费体验包（未配置密钥时使用演练口播数据）', status: 'adapter-ready' },
      { category: 'DEM 高程', purpose: '低洼区域分析', source: '公开 DEM（演练为设定值）', status: 'synthetic' },
      { category: '土地利用 / 不透水面', purpose: '积水易发风险分析', source: '公开土地利用产品（演练为设定值）', status: 'synthetic' },
      { category: '历史积水 / 历史灾害', purpose: '风险模型构建与验证', source: '公开灾情与积水点记录（演练为设定值）', status: 'synthetic' },
      { category: '人口统计', purpose: '人口暴露与社会脆弱性', source: '公开人口统计数据（演练为设定值）', status: 'synthetic' },
      { category: '老龄人口等结构数据', purpose: '脆弱群体识别', source: '公开人口结构数据（演练为设定值）', status: 'synthetic' },
      { category: '医院 / 避难场所 POI', purpose: '应急资源评价', source: '公开 POI（演练为设定点）', status: 'synthetic' },
      { category: '道路网络', purpose: '应急可达性与调度', source: '公开路网几何快照（演练为设定路网）', status: 'synthetic' },
      { category: '防汛应急预案等公开文件', purpose: 'RAG 知识库', source: '公开防汛预案与应急规范（见 assets/kb/SOURCES.md）', status: 'public-doc' }
    ],

    /* ---------- 免责声明（界面常驻 + 报告头部，禁止删改）---------- */
    disclaimer: {
      short: '基于公开数据的积水易发风险评估 · 演练用途',
      full: '本系统基于公开数据开展积水易发风险评估，输出结果与调度方案仅供演练与辅助决策参考，不构成对真实积水深度、受灾范围或人员安全的预测；所有调度方案均需由人工确认后执行。',
      boundary: [
        '不以自主训练基础大模型为目标，风险计算由统计/加权模型完成，大模型只做调度中枢与决策助手。',
        '不以高精度城市水动力仿真为主线，不做数字孪生城市。',
        '不宣称可精确预测某条道路未来积水多少厘米。',
        '地图展示遵守中国地图规范使用要求，采用合规数据来源与底图。',
        '本演示全部人员、容量、车速、路网为演练设定，仅使用模拟信息。'
      ]
    },

    /* ---------- 待办挂点（对应会议纪要 @乔阳-发言人1）---------- */
    realRegionHook: {
      status: 'pending',
      owner: '@乔阳-发言人1',
      note: '待补充「近期受台风影响最严重的具体线路或区域名称」，用于替换本文件的演练区域设定。',
      howTo: '在 ruian-scenario.js 中替换 zones / roads 的 name 与坐标即可，工具与智能体代码无需改动。'
    }
  };

  /* ---------------------------------------------------------------
   * 模型权重：风险模型 / SVI / 优先级
   * 全部外置且可审计 —— 对应 Word 文档「可解释AI」与「指标不宜过多」的要求。
   * 归一化区间一并写在这里，保证「同一输入 → 同一输出」可复现。
   * ------------------------------------------------------------- */
  FA.data.modelWeights = {
    version: '3.7.0-guardian',
    /* 积水易发风险：logistic 形加权模型（离线可复现，非水动力模型） */
    floodRisk: {
      method: 'weighted-logistic-proxy',
      methodLabel: '加权 Logistic 代理模型（演练口径）',
      intercept: -4.90,
      weights: {
        rainfall: 3.20,        // 归一化雨量（主导因子，保证 80/120/160 mm 单调可分）
        lowElevation: 1.45,    // 1 - 归一化高程
        impervious: 0.75,      // 不透水面比例
        history: 0.62,         // 历史易涝次数
        riverProximity: 0.52,  // 1 - 归一化距河距离
        drainageDeficit: 0.72  // 排水能力不足程度
      },
      normalize: {
        rainfallMm: [0, 200],
        elevationM: [2.0, 14.0],
        impervious: [0.30, 0.95],
        history: [0, 6],
        riverDistanceM: [0, 1600],
        drainageCapacity: { high: 0.1, mid: 0.5, low: 1.0 }
      },
      levels: [
        { key: 'low', label: '低', min: 0.00 },
        { key: 'medium', label: '中', min: 0.30 },
        { key: 'high', label: '高', min: 0.55 },
        { key: 'very-high', label: '极高', min: 0.75 }
      ],
      // 是否叠加「雨量情景抬升」，使 80/120/160mm 单调可分
      exposureScale: 0.55
    },

    /* 社会脆弱性指数 SVI：指标体系 + 加权求和（非 CDC SVI 照搬） */
    svi: {
      method: 'weighted-index',
      methodLabel: '指标体系加权法（演练口径）',
      indicators: [
        { key: 'elderlyRatio', label: '老龄人口占比', weight: 0.30, direction: 1, normalize: [0.05, 0.40] },
        { key: 'childRatio', label: '儿童占比', weight: 0.12, direction: 1, normalize: [0.03, 0.30] },
        { key: 'assistedRatio', label: '需协助人员占比', weight: 0.22, direction: 1, normalize: [0, 0.35] },
        { key: 'hospitalAccessMin', label: '医疗可达时间', weight: 0.18, direction: 1, normalize: [3, 30] },
        { key: 'shelterAccessMin', label: '避难点可达时间', weight: 0.18, direction: 1, normalize: [3, 20] }
      ],
      // 等级阈值按本演练底数下 SVI 的实际分布标定（观测区间约 0.18–0.51），
      // 使「高 / 极高」确有网格落入，否则创新点 1 的「高风险 × 高脆弱」永远命中不到。
      // 更换区域或指标后必须重新标定这三档阈值。
      levels: [
        { key: 'low', label: '低', min: 0.00 },
        { key: 'medium', label: '中', min: 0.30 },
        { key: 'high', label: '高', min: 0.42 },
        { key: 'very-high', label: '极高', min: 0.50 }
      ]
    },

    /* 应急响应优先级：灾害风险 + 人口暴露 + 社会脆弱性 + 应对能力 */
    priority: {
      method: 'weighted-composite',
      methodLabel: '灾害风险 + 人口暴露 + 社会脆弱性 + 应对能力 加权合成',
      weights: { risk: 0.40, exposure: 0.20, svi: 0.28, capabilityDeficit: 0.12 },
      normalize: { population: [120, 900] }
    },

    /* 动态触发标准：避免方案频繁变动（会议纪要明确要求） */
    trigger: {
      version: '3.7.0-trigger',
      thresholds: {
        rainfallDeltaMm: 20,        // 累计雨量增量（毫米）
        newHazardSeverity: 3,       // 新增险情严等级（1-5）
        hazardCount: 2,             // 新增险情条数
        closedRoadCount: 1,         // 新增阻断路段数
        affectedPeopleDelta: 3,     // 受影响人数增量
        planAgeMinutes: 30,         // 方案静默时长，超时提示复核
        minReplanIntervalMinutes: 15 // 最短重算间隔，防止抖动
      },
      // 未达阈值时的处置：accumulate = 只提示并累积，不重算
      belowThresholdAction: 'accumulate'
    },

    /* 调度目标函数可选口径 */
    objectives: [
      { key: 'risk_first', label: '风险优先', description: '优先转移高风险 × 高脆弱人群，允许总等待时间上升' },
      { key: 'wait_min', label: '等待最短', description: '优先压低加权等待，可能牺牲部分低风险家庭' },
      { key: 'balance', label: '覆盖均衡', description: '优先提高被安排人数与覆盖比例，兼顾等待' }
    ]
  };

  /* 统一的技术选型对照表 —— 直接用于 PPT「技术路线」页 */
  FA.data.techStack = [
    { module: 'AI 智能体', plan: 'LLM + Tool Calling（默认离线规则引擎，可切换）', role: '理解任务、调用工具、组织分析流程、生成决策建议', repo: 'anthropics/skills（Skill 规范）' },
    { module: 'RAG', plan: '本地知识库检索 + 大模型（默认离线关键词检索）', role: '检索公开防汛预案、应急规范，为建议提供依据', repo: 'chroma-core/chroma · qdrant/qdrant（可替换）' },
    { module: '洪涝风险模型', plan: '加权 Logistic 代理模型（预留 LightGBM/XGBoost/RF）', role: '对区域积水易发风险建模', repo: 'topics/flood-risk · topics/flood-prediction' },
    { module: '可解释 AI', plan: '因子贡献度分解（SHAP 风格）', role: '解释某区域为何成为高风险区域', repo: 'topics/flood-risk' },
    { module: '社会脆弱性分析', plan: '指标体系 + 加权合成（SVI）', role: '识别老龄人口等高脆弱区域', repo: 'RafaelaMartelo/FloodGPT-4_Prototype（架构参考）' },
    { module: 'GIS 空间分析', plan: 'GeoPandas / Shapely / NetworkX（前端为等价图算法）', role: '空间叠加、可达性、风险地图、路网分析', repo: 'geopandas · shapely · osmnx · networkx · pysal' },
    { module: '运筹优化', plan: 'OR-Tools 思路的约束 + 候选搜索 / 有界插入启发式', role: '避难点分配、人员转移与资源调度', repo: 'google/or-tools' },
    { module: '情景推演', plan: 'What-if 情景重算（80/120/160 mm）', role: '模拟不同降雨强度下的风险与调度结果', repo: 'projectmesa/mesa（可选 ABM）' },
    { module: '可视化', plan: '原生 SVG/Canvas 风险地图 + 调度路径', role: '风险地图、脆弱性地图、资源分布、调度路径', repo: 'keplergl/kepler.gl（可选）' }
  ];
})(window.FA = window.FA || {});
