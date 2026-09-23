// Prepared contracts only. This version intentionally makes no external requests.
export const integrationStatus={agent:{mode:'prepared',connected:false,provider:'DeepSeek（后续由 Agent 接入）',contract:'jiaoying-agent-v1'},weather:{mode:'prepared',connected:false,provider:'彩云天气',apiVersion:'v2.6',unit:'metric:v2',coordinateOrder:'longitude,latitude'},position:{mode:'prepared',connected:false,source:'当前为人工登记节点，不是 GPS'}};
export function prepareCaiyunRequest({longitude,latitude,coordinateSystem}){
  if(!Number.isFinite(longitude)||longitude< -180||longitude>180||!Number.isFinite(latitude)||latitude< -90||latitude>90)throw new Error('必须配置已核实的经纬度');
  if(!coordinateSystem)throw new Error('请明确并核对坐标体系');
  return {enabled:false,method:'GET',urlTemplate:`https://api.caiyunapp.com/v2.6/{serverCredential}/${longitude},${latitude}/weather?unit=metric:v2&lang=zh_CN&hourlysteps=24&dailysteps=1`,coordinateSystem,auth:'仅由后端读取凭证；启用时按彩云官方签名鉴权配置',timeoutMs:8000};
}
export function normalizeCaiyun(raw,{fetchedAt=new Date().toISOString()}={}){
  if(raw?.status!=='ok')throw new Error('天气服务未成功返回');
  if(raw.unit!=='metric:v2')throw new Error('降水单位未经确认，不能按毫米展示');
  const realtime=raw.result?.realtime,hourly=raw.result?.hourly,intensity=realtime?.status==='ok'?realtime.precipitation?.local?.intensity:null;
  const observedAt=Number.isFinite(raw.server_time)?new Date(raw.server_time*1000).toISOString():null,age=observedAt?Date.parse(fetchedAt)-Date.parse(observedAt):Infinity;
  return {sourceMode:'caiyun',fetchedAt,observedAt,stale:!Number.isFinite(age)||age< -60000||age>20*60*1000,unit:'mm/h',label:'当前降水强度（不是过去一小时累计量）',intensity:Number.isFinite(intensity)&&intensity>=0?intensity:null,forecast:hourly?.status==='ok'&&Array.isArray(hourly.precipitation)?hourly.precipitation.filter(x=>typeof x.datetime==='string'&&Number.isFinite(x.value)&&x.value>=0).map(x=>({time:x.datetime,intensity:x.value,unit:'mm/h'})):[],availableBlocks:Object.keys(raw.result||{}).filter(key=>raw.result[key]?.status==='ok')};
}
export const agentContract={schema:'jiaoying-agent-v1',mode:'prepared',connected:false,input:['requestId','utterance','snapshot','inputVersion','executionVersion'],output:['requestId','summary','proposedActions','evidence','inputVersion','executionVersion'],tools:[{name:'read_state',mutates:false},{name:'calculate_draft',mutates:true,requiresHumanConfirmation:false},{name:'prepare_report',mutates:false},{name:'propose_scenario',mutates:false}],rules:['Agent 返回建议，不直接调用确认、发布或安全核验操作','工具结果必须引用同一输入和执行版本','网页提交的动作由本地服务重新验证','不确定时澄清，不补造地点人数或预案条款']};
