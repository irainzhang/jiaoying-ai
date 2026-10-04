/*!
 * 城市韧性守护 Agent · 瑞安演练底数（写死数据）
 * ---------------------------------------------------------------
 * 会议纪要：「地图数据直接写死」以降低演示成本。
 * 因此本文件是一份自洽的、完全离线的演练快照：
 *   zones      网格 / 社区（风险与脆弱性的空间单元）
 *   groups     需转移人员组（家庭 / 村级小组）
 *   shelters   安置点（容量、无障碍位、可通行路网）
 *   vehicles   应急车辆（座位、无障碍位、驻地）
 *   roads      路网（分钟级行驶时间 + 可阻断）
 *   hazards    初始险情报告（可由地图长按新增）
 *
 * 全部为演练设定值。真实区域接入见 region-config.js 的 realRegionHook。
 */
(function (FA) {
  'use strict';

  FA.data = FA.data || {};

  /* ============================ 网格 / 社区 ============================ */
  // elevationM 高程 · impervious 不透水面 · history 历史易涝次数 · riverDistanceM 距河距离
  // drainage 排水能力 · population 常住人口 · elderly/child 结构比例
  // assisted 需协助人员数 · hospitalMin/shelterMin 可达时间（分钟）
  // roadGrade 道路条件（good/mid/poor） · hub 是否有应急集结点
  FA.data.zones = [
    { id: 'R01', name: '演练网格 R01', alias: '老城低洼片区', x: 118, y: 196, elevationM: 3.1, impervious: 0.82, history: 5, riverDistanceM: 180, drainage: 'low', population: 420, elderlyRatio: 0.26, childRatio: 0.10, assisted: 34, hospitalMin: 12, shelterMin: 5, roadGrade: 'mid', hub: true, shelterIds: ['S1'], note: '老城低洼，历史易涝次数最高' },
    { id: 'R02', name: '演练网格 R02', alias: '沿江片区', x: 208, y: 286, elevationM: 2.8, impervious: 0.74, history: 4, riverDistanceM: 120, drainage: 'low', population: 310, elderlyRatio: 0.22, childRatio: 0.12, assisted: 26, hospitalMin: 16, shelterMin: 8, roadGrade: 'mid', hub: false, shelterIds: ['S1'], note: '临江且排水能力偏低' },
    { id: 'R03', name: '演练网格 R03', alias: '老龄社区', x: 92, y: 320, elevationM: 3.6, impervious: 0.88, history: 3, riverDistanceM: 420, drainage: 'mid', population: 560, elderlyRatio: 0.31, childRatio: 0.08, assisted: 52, hospitalMin: 9, shelterMin: 4, roadGrade: 'good', hub: true, shelterIds: ['S1'], note: '老龄人口占比最高，社会脆弱性突出' },
    { id: 'R04', name: '演练网格 R04', alias: '新建小区', x: 268, y: 172, elevationM: 5.2, impervious: 0.79, history: 1, riverDistanceM: 700, drainage: 'high', population: 880, elderlyRatio: 0.12, childRatio: 0.18, assisted: 18, hospitalMin: 11, shelterMin: 3, roadGrade: 'good', hub: true, shelterIds: ['S1'], note: '地势较高，本身可作接收片区' },
    { id: 'R05', name: '演练网格 R05', alias: '城东园区', x: 392, y: 288, elevationM: 4.4, impervious: 0.91, history: 2, riverDistanceM: 900, drainage: 'mid', population: 240, elderlyRatio: 0.08, childRatio: 0.06, assisted: 6, hospitalMin: 18, shelterMin: 12, roadGrade: 'good', hub: false, shelterIds: [], note: '不透水面比例最高，昼间人口集中' },
    { id: 'R06', name: '演练网格 R06', alias: '山地村', x: 168, y: 84, elevationM: 12.5, impervious: 0.35, history: 2, riverDistanceM: 1500, drainage: 'low', population: 180, elderlyRatio: 0.34, childRatio: 0.09, assisted: 22, hospitalMin: 26, shelterMin: 15, roadGrade: 'poor', hub: false, shelterIds: ['S3'], note: '高程高但可达性差、老龄占比高' },
    { id: 'R07', name: '演练网格 R07', alias: '安置房社区', x: 176, y: 236, elevationM: 4.0, impervious: 0.72, history: 3, riverDistanceM: 520, drainage: 'mid', population: 640, elderlyRatio: 0.29, childRatio: 0.11, assisted: 44, hospitalMin: 10, shelterMin: 5, roadGrade: 'good', hub: true, shelterIds: ['S2'], note: '需协助人员绝对数较大' },
    { id: 'R08', name: '演练网格 R08', alias: '城西低洼', x: 296, y: 358, elevationM: 2.9, impervious: 0.68, history: 5, riverDistanceM: 200, drainage: 'low', population: 350, elderlyRatio: 0.25, childRatio: 0.13, assisted: 30, hospitalMin: 15, shelterMin: 9, roadGrade: 'mid', hub: false, shelterIds: ['S2'], note: '与 R02 同属沿江低洼带' },
    { id: 'R09', name: '演练网格 R09', alias: '医院周边', x: 344, y: 208, elevationM: 4.8, impervious: 0.85, history: 1, riverDistanceM: 800, drainage: 'high', population: 300, elderlyRatio: 0.18, childRatio: 0.14, assisted: 14, hospitalMin: 3, shelterMin: 6, roadGrade: 'good', hub: true, shelterIds: ['S2'], note: '医疗可达性最好，适合重点接收' },
    { id: 'R10', name: '演练网格 R10', alias: '学校片区', x: 236, y: 424, elevationM: 5.6, impervious: 0.77, history: 1, riverDistanceM: 1000, drainage: 'high', population: 720, elderlyRatio: 0.10, childRatio: 0.27, assisted: 20, hospitalMin: 8, shelterMin: 6, roadGrade: 'good', hub: false, shelterIds: [], note: '儿童占比最高，可作临时集结点评估' }
  ];

  /* ============================ 需转移人员组 ============================ */
  // stage: waiting 待安排 | arranged 已安排 | notified 已通知 | contacted 已联系
  //        boarded 已上车 | arrived 已到达 | held 待增援
  // 基准设定：8 组 15 人；车辆座位合计 15；无障碍位合计 2（与无障碍需求 2 恰好相等）。
  // 这样「初始接送」情景可全部安排，而基线策略因装箱碎片化会留下未安排人员，
  // 优化前后对比才有意义；降级情景（新增需求 / 车辆故障）则明确保留缺口。
  FA.data.groups = [
    { id: 'H1', zoneId: 'R01', name: '演练家庭 01', people: 2, elderly: 1, child: 0, assisted: true, wheelchair: 1, highRisk: true, mobility: 'limited', contact: '演练联系人 01', stage: 'waiting', note: '1 位卧床老人需无障碍车辆' },
    { id: 'H2', zoneId: 'R02', name: '演练家庭 02', people: 3, elderly: 1, child: 0, assisted: false, wheelchair: 0, highRisk: true, mobility: 'normal', contact: '演练联系人 02', stage: 'waiting', note: '' },
    { id: 'H3', zoneId: 'R03', name: '演练家庭 03', people: 2, elderly: 1, child: 0, assisted: true, wheelchair: 0, highRisk: false, mobility: 'limited', contact: '演练联系人 03', stage: 'waiting', note: '两位老人同住' },
    { id: 'H4', zoneId: 'R04', name: '演练家庭 04', people: 2, elderly: 0, child: 1, assisted: false, wheelchair: 0, highRisk: false, mobility: 'normal', contact: '演练联系人 04', stage: 'waiting', note: '' },
    { id: 'H5', zoneId: 'R06', name: '演练家庭 05', people: 2, elderly: 1, child: 0, assisted: true, wheelchair: 0, highRisk: false, mobility: 'normal', contact: '演练联系人 05', stage: 'waiting', note: '山地村，道路条件差，车程长' },
    { id: 'H6', zoneId: 'R08', name: '演练家庭 06', people: 2, elderly: 1, child: 0, assisted: true, wheelchair: 1, highRisk: true, mobility: 'limited', contact: '演练联系人 06', stage: 'waiting', note: '资源紧张时最易被挤出' },
    { id: 'H7', zoneId: 'R07', name: '演练家庭 07', people: 1, elderly: 1, child: 0, assisted: true, wheelchair: 0, highRisk: false, mobility: 'limited', contact: '演练联系人 07', stage: 'waiting', note: '独居老人' },
    { id: 'H8', zoneId: 'R05', name: '演练家庭 08', people: 1, elderly: 0, child: 0, assisted: false, wheelchair: 0, highRisk: false, mobility: 'normal', contact: '演练联系人 08', stage: 'waiting', note: '单人，常被最后安排' }
  ];

  // 村级新增需求（情景「村级新增 12 人」使用，默认关闭，由情景开关启用）
  // 合计 12 人：新增后总需求 27 人 > 15 个座位，用于演示「明确保留缺口」。
  FA.data.villageGrowthGroups = [
    { id: 'VG1', zoneId: 'R07', name: '演示村 A · VR1 第 1 组', people: 1, elderly: 1, child: 0, assisted: true, wheelchair: 0, highRisk: false, mobility: 'normal', contact: '演示村 A 联络员', stage: 'waiting', note: '' },
    { id: 'VG2', zoneId: 'R07', name: '演示村 A · VR1 第 2 组', people: 2, elderly: 1, child: 0, assisted: false, wheelchair: 0, highRisk: false, mobility: 'normal', contact: '演示村 A 联络员', stage: 'waiting', note: '' },
    { id: 'VG3', zoneId: 'R03', name: '演示村 A · VR1 第 3 组', people: 3, elderly: 2, child: 0, assisted: true, wheelchair: 0, highRisk: false, mobility: 'normal', contact: '演示村 A 联络员', stage: 'waiting', note: '' },
    { id: 'VG4', zoneId: 'R03', name: '演示村 A · VR1 第 4 组', people: 3, elderly: 1, child: 1, assisted: true, wheelchair: 1, highRisk: false, mobility: 'limited', contact: '演示村 A 联络员', stage: 'waiting', note: '' },
    { id: 'VG5', zoneId: 'R08', name: '演示村 B · VR2 第 1 组', people: 2, elderly: 1, child: 0, assisted: true, wheelchair: 0, highRisk: true, mobility: 'normal', contact: '演示村 B 联络员', stage: 'waiting', note: '' },
    { id: 'VG6', zoneId: 'R02', name: '演示村 B · VR2 第 2 组', people: 1, elderly: 0, child: 1, assisted: false, wheelchair: 0, highRisk: false, mobility: 'normal', contact: '演示村 B 联络员', stage: 'waiting', note: '' }
  ];

  /* ============================ 安置点 ============================ */
  FA.data.shelters = [
    { id: 'S1', name: '演练安置点 A', zoneId: 'R04', x: 286, y: 158, capacity: 10, wheelchairSlots: 2, status: 'open', occupied: 0, facilities: ['饮水', '临时床位'], note: '地势较高，位于新建小区' },
    { id: 'S2', name: '演练安置点 B', zoneId: 'R09', x: 362, y: 196, capacity: 12, wheelchairSlots: 2, status: 'open', occupied: 0, facilities: ['饮水', '医疗就近'], note: '紧邻医院片区，医疗可达性最好' },
    { id: 'S3', name: '演练安置点 C', zoneId: 'R06', x: 150, y: 68, capacity: 6, wheelchairSlots: 1, status: 'open', occupied: 0, facilities: ['饮水'], note: '山地村自有避难点，容量小、山路长' }
  ];

  /* ============================ 应急车辆 ============================ */
  FA.data.vehicles = [
    { id: 'V1', name: '1 号车', baseZoneId: 'R01', seats: 6, wheelchairSlots: 1, status: 'available', type: '无障碍中巴', note: '可接送卧床人员' },
    { id: 'V2', name: '2 号车', baseZoneId: 'R04', seats: 5, wheelchairSlots: 0, status: 'available', type: '普通客车', note: '' },
    { id: 'V3', name: '3 号车', baseZoneId: 'R09', seats: 4, wheelchairSlots: 1, status: 'available', type: '商务车', note: '' }
  ];

  /* ============================ 路网 ============================ */
  // minutes 为演练设定行驶时间；closed 表示当前阻断
  FA.data.roads = [
    { id: 'RD01', from: 'R01', to: 'R02', minutes: 4, closed: false, name: '演练路段 01' },
    { id: 'RD02', from: 'R01', to: 'R03', minutes: 3, closed: false, name: '演练路段 02' },
    { id: 'RD03', from: 'R01', to: 'R07', minutes: 6, closed: false, name: '演练路段 03' },
    { id: 'RD04', from: 'R02', to: 'R08', minutes: 5, closed: false, name: '演练路段 04' },
    { id: 'RD05', from: 'R03', to: 'R04', minutes: 7, closed: false, name: '演练路段 05' },
    { id: 'RD06', from: 'R04', to: 'R09', minutes: 4, closed: false, name: '演练路段 06' },
    { id: 'RD07', from: 'R05', to: 'R09', minutes: 5, closed: false, name: '演练路段 07' },
    { id: 'RD08', from: 'R06', to: 'R07', minutes: 11, closed: false, name: '演练山路 08' },
    { id: 'RD09', from: 'R07', to: 'R09', minutes: 6, closed: false, name: '演练路段 09' },
    { id: 'RD10', from: 'R08', to: 'R05', minutes: 9, closed: false, name: '演练路段 10' },
    { id: 'RD11', from: 'R04', to: 'R07', minutes: 5, closed: false, name: '演练路段 11' },
    { id: 'RD12', from: 'R06', to: 'R09', minutes: 17, closed: false, name: '演练山路 12' },
    { id: 'RD13', from: 'R09', to: 'R10', minutes: 6, closed: false, name: '演练路段 13' },
    { id: 'RD14', from: 'R08', to: 'R10', minutes: 8, closed: false, name: '演练路段 14' }
  ];

  /* ============================ 初始险情 ============================ */
  // severity 1-5；source: map-longpress 地图长按 | oral 口播 | field 现场
  FA.data.hazards = [
    { id: 'HZ-INIT-1', zoneId: 'R02', severity: 2, source: 'field', note: '沿江片区路面积水，车辆仍可通行', at: 'T-00:12', confirmed: true },
    { id: 'HZ-INIT-2', zoneId: 'R08', severity: 3, source: 'field', note: '城西低洼路段积水较深，建议绕行', at: 'T-00:08', confirmed: true }
  ];

  /* ============================ 情景预设 ============================ */
  FA.data.scenarios = [
    { id: 'normal', name: '初始接送', rainfallMm: 35, closedRoadIds: [], enableVillageGrowth: false, vehicleOffline: [], shelterClosed: [], description: '基线情景：无路段阻断、车辆齐备' },
    { id: 'rain-80', name: '降雨 80 mm', rainfallMm: 80, closedRoadIds: [], enableVillageGrowth: false, vehicleOffline: [], shelterClosed: [], description: '未来 6 小时累计 80 毫米' },
    { id: 'rain-120', name: '降雨 120 mm', rainfallMm: 120, closedRoadIds: [], enableVillageGrowth: false, vehicleOffline: [], shelterClosed: [], description: '明星 Demo 情景：未来 6 小时累计 120 毫米' },
    { id: 'rain-160', name: '降雨 160 mm', rainfallMm: 160, closedRoadIds: [], enableVillageGrowth: false, vehicleOffline: [], shelterClosed: [], description: '雨情继续恶化：未来 6 小时累计 160 毫米' },
    { id: 'road-closure', name: '道路中断', rainfallMm: 120, closedRoadIds: ['RD04', 'RD08'], enableVillageGrowth: false, vehicleOffline: [], shelterClosed: [], description: '沿江与山路两条路段阻断' },
    { id: 'village-growth', name: '村级新增 12 人', rainfallMm: 120, closedRoadIds: [], enableVillageGrowth: true, vehicleOffline: [], shelterClosed: [], description: '村级新增 6 组共 18 人需求' },
    { id: 'resource-shortage', name: '车辆故障', rainfallMm: 120, closedRoadIds: [], enableVillageGrowth: false, vehicleOffline: ['V1'], shelterClosed: [], description: '1 号无障碍车故障退出' },
    { id: 'shelter-loss', name: '安置点停用', rainfallMm: 120, closedRoadIds: [], enableVillageGrowth: false, vehicleOffline: [], shelterClosed: ['S1'], description: '演练安置点 A 停用' }
  ];

  /* ============================ 规模验证生成器 ============================ */
  /**
   * 生成 N 组规模测试数据（用于评估算法在大规模下的表现与降级策略）。
   * 结果确定性：同一 N 一定得到同一份数据。
   */
  FA.data.generateScaleGroups = function (count) {
    var zoneIds = FA.data.zones.map(function (z) { return z.id; });
    var out = [];
    for (var i = 1; i <= count; i++) {
      var zoneId = zoneIds[i % zoneIds.length];
      out.push({
        id: 'LOAD' + i,
        zoneId: zoneId,
        name: '规模演练组 ' + i,
        people: 1 + (i % 3 === 0 ? 2 : 0),
        elderly: i % 4 === 0 ? 1 : 0,
        child: i % 5 === 0 ? 1 : 0,
        assisted: i % 3 === 0,
        wheelchair: i % 7 === 0 ? 1 : 0,
        highRisk: i % 4 === 1,
        mobility: i % 7 === 0 ? 'limited' : 'normal',
        contact: '规模联络员 ' + i,
        stage: 'waiting',
        note: ''
      });
    }
    return out;
  };

  /* ============================ 快照工具 ============================ */
  FA.data.clone = function (v) { return JSON.parse(JSON.stringify(v)); };

  /** 深拷贝一份完整场景，供状态仓库初始化/重置使用 */
  FA.data.createSnapshot = function () {
    return {
      scenarioId: 'normal',
      rainfallMm: FA.data.region.demo.defaultRainfallMm,
      horizonHours: FA.data.region.demo.scenarioHorizonHours,
      zones: FA.data.clone(FA.data.zones),
      groups: FA.data.clone(FA.data.groups),
      shelters: FA.data.clone(FA.data.shelters),
      vehicles: FA.data.clone(FA.data.vehicles),
      roads: FA.data.clone(FA.data.roads),
      hazards: FA.data.clone(FA.data.hazards),
      enableVillageGrowth: false,
      vehicleOffline: [],
      shelterClosed: [],
      updatedAt: null
    };
  };
})(window.FA = window.FA || {});
