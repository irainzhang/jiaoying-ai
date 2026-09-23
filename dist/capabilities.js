(function(root){
  const data={version:'3.6.0',date:'2026-09-23',title:'叫应 AI · 瑞安转移协同演练',modelConnected:false,agentConnected:false,weatherConnected:false,crossDeviceSync:false,entries:[
    {id:'O01',name:'数据来源目录',status:'已实现 / 待外部核实',detail:'道路、合成业务、天气与预案列明出处。地图来源和合成数据的赛事适用性仍需组委会确认。'},
    {id:'O02',name:'模型与 Agent',status:'按要求暂缓',detail:'不接入 DeepSeek 或 Agent；保留契约，使用规则整理和实际调度算法。'},
    {id:'O03',name:'真实道路与调度统一',status:'已实现',detail:'瑞安局部道路绑定演练点位，遵守单向通行，计算路线并支持点选上报；速度和开放状态为演练假设。'},
    {id:'O04',name:'公开预案参考卡',status:'已实现',detail:'浙江与瑞安公开预案追溯到文件和条款，仅作流程参考，非路线审批或官方授权。'},
    {id:'O05',name:'可复现效果评估',status:'已实现 / 模型评估暂缓',detail:'固定情景、同输入基线与优化，记录覆盖、等待、约束校验与耗时；不主张 AI 增益。'},
    {id:'O06',name:'情景库与演示引导',status:'已实现',detail:'初始、真实道路、封路、新增12人、运力不足、接收点失效；人工演示和 JSON 复盘恢复。'},
    {id:'O07',name:'指挥待办与跟进',status:'已实现',detail:'按核实情况、安排转移、跟踪完成分区；优先显示待核实、受阻、到达待核验，其他跟进按需展开。'},
    {id:'O08',name:'村级上报易用性',status:'已实现',detail:'现场分报情况、我的任务、上报记录；两步上报、当前任务下一步、浅色界面与固定对话入口；保留总数、更正和草稿。'},
    {id:'O09',name:'资源失效应对',status:'已实现',detail:'执行中车辆或接收点失效可登记重算；已上车保持原车，缺口保留，恢复需人工核实。'},
    {id:'O10',name:'方案变更影响',status:'已实现',detail:'逐车比较原方案和草案；同级天气不重排，重复请求不重记，关键障碍立即复核。'},
    {id:'O11',name:'基线与未安排解释',status:'已实现',detail:'逐车、逐组、逐接收点比较，区分运力、适配、容量和通行问题，展示协助人群等待。'},
    {id:'O12',name:'复盘报告',status:'已实现',detail:'补入村级批次、更正、未决事项、人工确认、版本、计算诊断和来源，可打印与导出 JSON。'},
    {id:'O13',name:'保存与恢复',status:'已实现',detail:'公开版浏览器保存，本地新版磁盘保存；导入完整校验并撤销旧发布，存储失败不误报成功。'},
    {id:'O14',name:'天气来源与接口',status:'准备完成 / 实况暂缓',detail:'彩云接口和单位校验已准备，当前只使用明确标识的一小时累计雨量演练。'},
    {id:'O15',name:'统一版本说明',status:'已实现',detail:'入口、报告与说明共用当前能力目录，旧核对表明确为历史基准。'},
    {id:'O16',name:'参赛材料',status:'框架已准备',detail:'提供8—10分钟讲解脚本和提交核对清单；最终 PPT、实录视频、本人签名承诺书待定版制作。'},
    {id:'O17',name:'跨设备协作',status:'待部署条件',detail:'GitHub 支持同浏览器双端联动；手机与电脑共享房间仍需额外后端和访问配置。'},
    {id:'O18',name:'地区配置与规模验证',status:'部分实现',detail:'情景与真实道路配置可复用，提供规模实测；多趟、换车、真实 GPS 和跨地区验证待扩展。'}],limits:['人员、村庄、车辆、接收点用途与道路状态均为演练。','单车单趟，有限途中重规划，不能保证所有规模的全局最优。','未连接原叫应系统，未取得其接口或官方授权。','公开访问不等于跨设备共享，浏览器清理可能删除本机记录。']};
  if(typeof module==='object'&&module.exports)module.exports=data;else root.JiaoyingCapabilities=data;
})(typeof window==='object'?window:globalThis);
