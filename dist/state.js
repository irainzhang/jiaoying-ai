(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./engine.js'));
  else root.JiaoyingState=factory(root.JiaoyingEngine);
})(typeof globalThis!=='undefined'?globalThis:this,function(E){
  'use strict';
  function create(){
    let data;
    function log(message){data.log.unshift({sequence:data.log.length+1,time:new Date().toISOString(),version:data.version,message});}
    function reset(){data={scenario:E.createScenario(),version:1,plan:null,baseline:null,planVersion:0,planInput:null,confirmed:null,phase:'preparation',sent:false,contact:{},execution:{},receipts:[],pending:[],log:[]};for(const h of data.scenario.households){h.response='暂无本轮回执';data.contact[h.id]={ack:false,contacted:false};data.execution[h.id]='waiting';}log('载入虚构演练。6 户 15 人，3 辆车，2 个安置点。');}
    const fresh=()=>Boolean(data.plan&&data.planVersion===data.version);
    function unlocked(){if(data.phase!=='preparation')throw new Error('已进入模拟执行，人员和路线已冻结；途中调度需人工协调，本版需重置后开始新演练。');}
    function invalidate(reason){data.version++;data.confirmed=null;log(reason+'；输入已更新，原方案需重新计算。');}
    function change(mutator,reason){unlocked();const next=E.clone(data.scenario);mutator(next);E.validateScenario(next);if(JSON.stringify(next)===JSON.stringify(data.scenario))return false;const changes=[];for(const kind of ['households','vehicles','shelters','edges'])for(const item of next[kind]){const before=data.scenario[kind].find(x=>x.id===item.id);for(const key of Object.keys(item))if(before[key]!==item[key])changes.push({kind,id:item.id,field:key,before:before[key],after:item[key]});}data.scenario=next;invalidate(reason);data.log[0].changes=changes;return true;}
    function updateHousehold(id,fields){
      if(!data.scenario.households.some(h=>h.id===id))throw new Error('家庭不存在');
      const keys=['people','priority','service','assistance','wheelchair'];
      return change(s=>{const h=s.households.find(h=>h.id===id);for(const key of keys)if(key in fields)h[key]=fields[key];if(h.wheelchair||h.priority===2)h.assistance=true;if(h.assistance){h.priority=Math.max(2,h.priority);h.service=Math.max(h.wheelchair?6:5,h.service);}},data.scenario.households.find(h=>h.id===id).name+'：人工保存人数、需求与接人时间');
    }
    function updateResource(kind,id,fields){
      if(!['vehicles','shelters'].includes(kind))throw new Error('资源类型无效');
      if(!data.scenario[kind].some(r=>r.id===id))throw new Error('资源不存在');
      return change(s=>{const r=s[kind].find(x=>x.id===id);for(const key of kind==='vehicles'?['capacity','available','wheelchair']:['capacity','available'])if(key in fields)r[key]=fields[key];},'人工保存资源 '+id+' 的容量与可用状态');
    }
    function setEvent(kind,active){
      if(typeof active!=='boolean'||!['bridge','north','shelter','vehicle'].includes(kind))throw new Error('情景事件参数无效');
      const names={bridge:'东桥封闭',north:'北桥封闭',shelter:'体育馆暂停接收',vehicle:'2 号车停用'};
      return change(s=>{if(kind==='bridge'||kind==='north')s.edges.find(e=>e.id===(kind==='bridge'?'east':'north')).open=!active;else if(kind==='shelter')s.shelters.find(x=>x.id==='S2').available=!active;else s.vehicles.find(x=>x.id==='V2').available=!active;},names[kind]+'：'+(active?'开启':'解除'));
    }
    function generate(){
      unlocked();const input=E.clone(data.scenario),plan=E.solve(input),baseline=E.baseline(input);
      for(const p of [plan,baseline]){const errors=E.validatePlan(input,p);if(errors.length)throw new Error('校验失败：'+errors.join('、'));}
      data.plan=plan;data.baseline=baseline;data.planInput=input;data.planVersion=data.version;data.confirmed=null;
      log('同一输入计算两种方案：联合调度 '+plan.servedPeople+' 人，简单基线 '+baseline.servedPeople+' 人。');return E.clone(plan);
    }
    function confirm(note=''){
      unlocked();if(!fresh())throw new Error('当前没有有效方案，请重新计算');
      if(!data.plan.servedPeople)throw new Error('没有可执行的接送安排，请补充资源');
      if(!data.plan.complete&&String(note).trim().length<5)throw new Error('请登记未安排家庭的协调措施（至少 5 个字），再确认可行部分');
      const errors=E.validatePlan(data.scenario,data.plan);if(errors.length)throw new Error('方案约束未通过');
      if(data.confirmed)return;
      data.confirmed={version:data.version,partial:!data.plan.complete,note:String(note).trim()};
      log((data.plan.complete?'人工确认全体接送草案':'人工确认可行部分；未安排家庭仍待协调：'+note)+'。尚未出发。');
    }
    function publish(){unlocked();if(data.sent)return;data.sent=true;log('模拟发布预警叫应任务，范围为本次全部家庭；未发送真实消息。');}
    function acknowledge(id){if(!data.sent)throw new Error('请先模拟发布叫应任务');if(!data.contact[id])throw new Error('家庭不存在');if(data.contact[id].ack)return;data.contact[id].ack=true;log(id+' 的演练包保员确认收到任务；未确认家庭安全。');}
    function contact(id){if(!data.contact[id]?.ack)throw new Error('包保员应先确认收到任务');if(data.contact[id].contacted)return;data.contact[id].contacted=true;log(id+'：人工登记已联系到家庭，未确认上车或到达。');}
    function start(){
      unlocked();if(!fresh()||!data.confirmed)throw new Error('请先确认当前方案');
      if(!data.sent)throw new Error('请先在预警叫应页模拟发布任务');
      const ids=data.plan.routes.flatMap(r=>r.stops.map(st=>st.id));
      if(ids.some(id=>!data.contact[id].contacted))throw new Error('已安排家庭仍有未联系记录，请先完成预警叫应页的联系确认');
      data.phase='executing';log('开始模拟执行。已确认路线与输入冻结；本版不支持途中自动重排。');
    }
    function advance(id,action){
      if(data.phase!=='executing')throw new Error('请先开始模拟执行');
      const route=data.plan.routes.find(r=>r.stops.some(st=>st.id===id));if(!route)throw new Error('该家庭尚未安排，需继续协调');
      if(data.pending.some(item=>item.id===id))throw new Error('该家庭有未解决的新增需求，已暂停接送记录；需先人工协调，本版不能自动解除或途中换车。');
      const ix=route.stops.findIndex(st=>st.id===id),stage=data.execution[id];
      if(action==='board'){
        if(stage!=='waiting'||route.stops.slice(0,ix).some(st=>data.execution[st.id]==='waiting'))throw new Error('请按接送顺序登记上车，不能跳过前一户');
        data.execution[id]='boarded';
      }else if(action==='arrive'){
        if(stage!=='boarded'||route.stops.some(st=>data.execution[st.id]==='waiting'))throw new Error('本车应完成各户接人后，再登记安置点到达');
        data.execution[id]='arrived';
      }else if(action==='verify'){
        if(stage!=='arrived')throw new Error('必须先有到达登记，再由演示者人工核验');
        data.execution[id]='verified';
      }else throw new Error('执行动作无效');
      log(id+'：'+{board:'人工登记模拟上车',arrive:'模拟到达上报，待安置点核验',verify:'人工核验演练到达记录'}[action]);
    }
    function receipt(id,text,checked){
      const h=data.scenario.households.find(h=>h.id===id);if(!h)throw new Error('家庭不存在');
      const parsed=E.parseReceipt(text),fields={assistance:!!checked?.assistance||!!checked?.wheelchair,wheelchair:!!checked?.wheelchair};
      const needsChange=(fields.assistance&&!h.assistance)||(fields.wheelchair&&!h.wheelchair);
      if(needsChange&&data.phase==='preparation')updateHousehold(id,{assistance:h.assistance||fields.assistance,wheelchair:h.wheelchair||fields.wheelchair});
      if(needsChange&&data.phase==='executing'){data.pending.push({id,need:fields,text,planVersion:data.planVersion});log(id+' 执行中新增需求：保留已确认路线，登记为待人工协调事项。');}
      data.scenario.households.find(x=>x.id===id).response=parsed.status;
      data.receipts.unshift({id,text,parsed,checked:fields,version:data.version,executionPhase:data.phase});log(id+' 回执人工核对登记：'+parsed.status+'；文本不会改变上车或核验状态。');
      return {changed:needsChange,pending:needsChange&&data.phase==='executing'};
    }
    function exportData(){return E.clone({schema:'jiaoying-demo-v2',dataNature:'全部为虚构演练数据；不是原叫应业务数据',modelMode:'finite-text-rules-no-llm',scope:'出发前单趟规划；执行阶段冻结路线',...data});}
    reset();return {get data(){return data;},fresh,reset,updateHousehold,updateResource,setEvent,generate,confirm,publish,acknowledge,contact,start,advance,receipt,exportData};
  }
  return {create};
});
