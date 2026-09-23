(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./village-assistant.js'));
  else root.JiaoyingQuickContext = factory(root.JiaoyingVillageAssistant);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (assistant) {
  'use strict';

  // Reuse registered places and the next published task; never pick a default
  // village or infer absent assistance, wheelchair, or grouping facts.
  const compact=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toUpperCase();
  const contains=(text,name)=>{
    const key=compact(name);
    if(!key)return false;
    return /^[A-Z0-9-]+$/.test(key)?new RegExp('(^|[^A-Z0-9-])'+key+'(?![A-Z0-9-])').test(text):text.includes(key);
  };
  const named=(text,item)=>[item.id,item.name,...(item.aliases||[])].some(name=>contains(text,name));
  const shortName=pickup=>compact(pickup.name).replace(/[(（]演示[)）]/g,'');
  const pickupNamed=(text,pickup)=>named(text,pickup)||Boolean(shortName(pickup)&&text.includes(shortName(pickup)));
  const villagesOf=data=>Array.isArray(data?.villages)?data.villages:[];
  const allPickups=villages=>villages.flatMap(village=>(village.pickups||[]).map(pickup=>({village,pickup})));
  const empty=()=>({villageId:'',pickupId:'',label:'尚未确定所属村庄与集合点',source:'none'});
  const selected=(village,pickup,source)=>({villageId:village.id,pickupId:pickup?.id||'',label:village.name+' · '+(pickup?.name||'集合点待补充'),source});

  function scope(data,options={}) {
    const villages=villagesOf(data),points=allPickups(villages);
    if(options.villageId||options.pickupId){
      const village=villages.find(v=>v.id===options.villageId);
      if(options.villageId){
        // Keep an invalid explicit selection visible to the parser instead of
        // silently replacing it with another vehicle's location.
        if(!village)return {villageId:options.villageId,pickupId:options.pickupId||'',label:'所选村庄待核对',source:'selection'};
        const pickup=(village.pickups||[]).find(p=>p.id===options.pickupId);
        if(options.pickupId&&!pickup)return {villageId:village.id,pickupId:options.pickupId,label:village.name+' · 所选集合点待核对',source:'selection'};
        return selected(village,pickup,'selection');
      }
      const matches=points.filter(point=>point.pickup.id===options.pickupId);
      if(matches.length===1)return selected(matches[0].village,matches[0].pickup,'selection');
      return {villageId:'',pickupId:options.pickupId,label:'所选集合点待核对',source:'selection'};
    }
    if(!options.vehicleId)return empty();
    const route=data?.activePlan?.routes?.find(r=>r.vehicleId===options.vehicleId);
    const next=route?.stops?.find(stop=>data.stage?.[stop.id]==='waiting');
    const household=(data?.scenario?.households||[]).find(h=>h.id===next?.id);
    if(!household)return empty();
    const village=villages.find(v=>v.id===household.villageId);
    if(village){
      const pickup=(village.pickups||[]).find(p=>p.id===household.pickupId);
      if(pickup)return selected(village,pickup,'task');
      const matches=(village.pickups||[]).filter(p=>p.node===household.node);
      return selected(village,matches.length===1?matches[0]:null,'task');
    }
    const matches=points.filter(point=>point.pickup.node===household.node);
    return matches.length===1?selected(matches[0].village,matches[0].pickup,'task'):empty();
  }

  function prepare(text,context={}) {
    const data=context.data||{},villages=villagesOf(data),points=allPickups(villages),spoken=compact(text);
    const previous=context.scope||{},explicitVillages=villages.filter(v=>named(spoken,v));
    const mentionedPoints=points.filter(point=>pickupNamed(spoken,point.pickup));
    let villageId=previous.villageId||'',pickupId=previous.pickupId||'';
    if(explicitVillages.length===1){
      if(villageId!==explicitVillages[0].id)pickupId='';
      villageId=explicitVillages[0].id;
      const local=mentionedPoints.filter(point=>point.village.id===villageId);
      if(local.length===1)pickupId=local[0].pickup.id;
    }else if(!explicitVillages.length){
      // Globally unique IDs/names can identify a different village. Common
      // names such as “村委会集合点” only resolve inside an established village.
      if(mentionedPoints.length===1){villageId=mentionedPoints[0].village.id;pickupId=mentionedPoints[0].pickup.id;}
      else {
        const local=mentionedPoints.filter(point=>point.village.id===villageId);
        if(local.length===1)pickupId=local[0].pickup.id;
      }
    }
    if(/(?:集合点|位置|点位)(?:还|尚)?(?:未定|未确定|不清楚|不知道|待定)|还没确定集合点/.test(spoken))pickupId='';
    const prepared=assistant.prepare(text,{data,villageId,pickupId,mode:'increment',reporter:context.reporter,source:context.source});
    const otherIntent=/更正|改为|改成|修正|应为|填错|报错|(?:目前|当前|现在|现有|此刻|截至).{0,16}(?:待转移|等待转移|等待接送|等待|待接|还有|共有|总计|剩余)|(?:待转移|等待转移|等待接送|待接)(?:总量|总人数|合计|共计)|(?:仍有|还有).{0,8}(?:待转移|等待转移|需(?:要)?转移)|(?:已|已经)(?:联系|上车|到达|送达|抵达)|收到(?:了)?任务|道路受阻|路段受阻|封路|无法通行|不能通行/.test(spoken);
    if(otherIntent||prepared.proposal&&prepared.proposal.payload.mode!=='increment'){
      prepared.proposal=null;prepared.intent='clarify';prepared.title='请区分新增人员与其他反馈';
      prepared.summary='快速补报只增加新发现的人员，确认前不会改变台账。';
      prepared.questions=[...new Set([...prepared.questions,'这里仅补报新发现的人员；人数更正、总量盘点或执行进展请使用对应入口，避免重复累计。'])];
    }
    return prepared;
  }

  return {scope,prepare};
});
