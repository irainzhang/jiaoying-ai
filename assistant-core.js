(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./engine.js'));else root.JiaoyingAssistantCore=factory(root.JiaoyingEngine);})(typeof globalThis!=='undefined'?globalThis:this,function(E){
  'use strict';
  function rawSnapshot(store){
    const d=store.data,s=d.scenario,p=store.fresh()?d.plan:null;
    return {dataNature:'虚构演练，非真实应急任务',version:d.version,revision:d.log[0]?.sequence||0,phase:d.phase,planState:!d.plan?'empty':!store.fresh()?'stale':d.confirmed?'confirmed':p.complete?'draft':'partial',planVersion:p?d.planVersion:null,totalPeople:s.households.reduce((n,h)=>n+h.people,0),households:s.households.map(h=>({...h,contact:d.contact[h.id],execution:d.execution[h.id]})),vehicles:s.vehicles,shelters:s.shelters,roads:s.edges.map(e=>({id:e.id,from:e.from,to:e.to,minutes:e.minutes,open:e.open})),plan:p?{servedPeople:p.servedPeople,complete:p.complete,finish:p.finish,priorityAverage:p.priorityAverage,routes:p.routes.filter(r=>r.stops.length),unassigned:p.unassigned.map(h=>({id:h.id,name:h.name,people:h.people,reason:h.reason}))}:null,baseline:p?{servedPeople:d.baseline.servedPeople,finish:d.baseline.finish,samePeople:d.baseline.mask===p.mask}:null,pending:d.pending,limits:['未接入原叫应系统','全部为合成演练输入','单车单趟、家庭不拆分','仅支持出发前重规划','回执不自动确认安全']};
  }
  const snapshot=store=>E.clone(rawSnapshot(store));
  const fingerprint=store=>JSON.stringify(snapshot(store));
  function localReply(text,c){
    const input=String(text||'').trim();if(!input)throw new Error('请先输入想问的问题');if(input.length>2000)throw new Error('单条问题请控制在 2000 字以内');
    const plan=c.plan,locked=c.phase!=='preparation',homes=c.households.filter(h=>input.includes(h.name)),actions=[];
    const noChange=/(?:不要|别|无需|不用|不必|不需要).{0,8}(?:生成|计算|规划|重算|重排|更改|修改|封闭|关闭|封路)/.test(input);
    const receiptIntent=/(?:通知|收到|家属|老人|腿脚|行动不便|需要.*(?:轮椅|陪同|接送|协助)|回执|已到达)/.test(input)&&!/为什么|为何|哪些|谁|多少|情况|汇总/.test(input);
    const generate=()=>{if(!locked&&!noChange)actions.push({type:'generate',label:'计算当前接送草案'});};
    let reply='';
    if(/东桥|北桥/.test(input)&&!receiptIntent){
      const bridge=input.includes('北桥')?'north':'bridge',road=c.roads.find(e=>e.id===(bridge==='north'?'north':'east')),label=bridge==='north'?'北桥':'东桥';
      reply=`当前输入 v${c.version} 中，${label}${road.open?'设为开放':'已设为封闭'}。`;
      if(locked)reply+='当前已进入模拟执行，车辆与路线冻结。本版不能从集结点重新生成途中安排，请由现场人员协调并在转移反馈中记录。';
      else if(noChange||!/(?:封闭|关闭|封路)/.test(input)||/(?:没有|尚未|并未|未|不).{0,3}(?:封闭|关闭|封路)/.test(input)||input.includes('东桥')&&input.includes('北桥'))reply+='这条消息没有更新道路状态。若需比较封桥情景，请一次指定一座桥，例如“如果东桥封闭会怎样”。';
      else{reply+='可以把“该桥封闭”作为演练条件，再同时重算联合调度与简单基线。可能绕行，也可能有家庭无法安排，须以计算结果为准。\n这条回复尚未改动路况或方案。';actions.push({type:'bridge',event:bridge,label:`按${label}封闭重算草案`});}
    }else if(receiptIntent){
      if(input.length>1000)return {reply:'这条现场反馈超过核实页的 1000 字上限。请按家庭拆分，保留完整的对象、需求和否定描述后再发送；当前没有截断或登记原文。',actions:[],mode:'local'};
      const parsed=E.parseReceipt(input),id=homes.length===1?homes[0].id:null;
      reply=`可以把原文带入回执核实。${id?'匹配到本次演练的'+homes[0].name+'。':homes.length>1?'这段话涉及多户，请按家庭分别核实。':'还不能确定对应哪一户，请先选择家庭。'}\n当前规则提示：${parsed.needsWheelchair?'轮椅适配需求；':''}${parsed.needsAssistance?'上门协助需求。':'协助类型仍需人工判断。'}${/腿脚|老人/.test(input)&&!parsed.needsWheelchair?'“老人”或“腿脚不便”不能直接认定为需要轮椅。':''}\n${locked?'执行中新增核实需求会进入待协调清单，并暂停该户继续登记；当前路线不会自动改变。':'进入核实页后可以修改建议，确认登记才会更新需求；人数保持原台账值。'}`;
      actions.push({type:'receipt',householdId:id,text:input,label:'带入回执核实'});
    }else if(/未安排|没安排|没有安排|遗漏|谁还|资源不足|缺口|待协调/.test(input)){
      if(!plan){reply=c.planState==='stale'?'原方案已失效，不能用旧结果判断谁已安排。':'还没有当前版本的草案，不能判断未安排家庭。';generate();}
      else if(plan.unassigned.length)reply=`当前 v${c.version} 草案安排 ${plan.servedPeople} / ${c.totalPeople} 人，以下家庭仍待协调：\n`+plan.unassigned.map(h=>`• ${h.name}，${h.people} 人：${h.reason}`).join('\n')+'\n可以核对车辆适配、单车容量和安置名额，再重新计算。';
      else reply=`当前草案已为 ${c.households.length} 户 ${c.totalPeople} 人提供接送安排。安排完成不代表人员已经到达；请在转移反馈中查看上车和人工核验记录。`;
      if(c.pending.length)reply+='\n另有执行中新增需求 '+c.pending.length+' 项，仍需人工协调。';
    }else if(/为什么|为何|解释|路线|怎么走|派车|分配|安排/.test(input)&&!/(?:重新|生成|计算|规划|重算|重排)/.test(input)){
      if(!plan){reply='还没有当前有效的草案，无法解释具体车辆分配。先计算后，可依据结果说明每辆车的接人顺序与容量。';generate();}
      else{const matching=plan.routes.filter(r=>!homes.length||r.stops.some(st=>homes.some(h=>h.id===st.id)));reply='当前方案先考虑优先转移户和协助户覆盖，再考虑总人数与重点等待。车辆座位、轮椅位、安置容量和开放道路都是硬约束。\n'+matching.map(r=>{const v=c.vehicles.find(v=>v.id===r.vehicleId),sh=c.shelters.find(s=>s.id===r.shelterId);return `• ${v.name}：${r.stops.map(st=>c.households.find(h=>h.id===st.id).name+'（+'+st.arrival+' 分到户）').join(' → ')}，送往${sh.name}；${r.people}/${v.capacity} 人，+${r.finish} 分抵达。`;}).join('\n')+'\n这是当前候选方案的计算结果，不表示已证明全局最优；具体路段可在调度页点击单车路线。';}
    }else if(/生成|计算|规划|重算|重排/.test(input)&&!noChange){
      reply=locked?'当前已进入模拟执行，不能重新分配在途车辆和家庭。请保留当前路线并记录现场协调事项。':'可以按当前全部家庭、车辆、道路和安置容量，计算接送草案与简单基线。\n点击下方按钮才运行算法；结果仍需在调度页人工确认。';generate();
    }else if(/你好|您好|能做|帮我|情况|总结|汇总|进度|当前|现在/.test(input)){
      const contacted=c.households.filter(h=>h.contact.contacted).length,verified=c.households.filter(h=>h.execution==='verified').reduce((n,h)=>n+h.people,0);
      reply=`当前是青岚镇虚构演练，输入 v${c.version}，${c.households.length} 户 ${c.totalPeople} 人；已联系 ${contacted} 户，已人工核验 ${verified} 人。\n${plan?`草案安排 ${plan.servedPeople} 人，预计最后抵达 +${plan.finish} 分。`:c.planState==='stale'?'旧方案已失效，需要重新计算。':'尚未生成接送草案。'}\n可用车辆 ${c.vehicles.filter(v=>v.available).length} 辆，开放安置点 ${c.shelters.filter(s=>s.available).length} 个。${locked?'当前执行中，路线冻结。':'当前处于出发前准备。'}\n你可以继续问“谁还没安排”“为什么这样派车”，或输入一条现场反馈。`;
    }else reply='目前处于本地导览模式，尚未连接大模型，不能可靠理解这类自由提问。\n可以问“总结当前情况”“谁还没安排”“为什么这样派车”，也能把指定家庭的反馈带入核实页。接入模型后，这个入口可用于更开放的多轮交流。';
    return {reply,actions,mode:'local'};
  }
  return {snapshot,fingerprint,localReply};
});
