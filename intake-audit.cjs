'use strict';
// Reviewed intake provenance, not proof that a vendor authenticated a result.
// Keep only business fields; never persist arbitrary provider responses/config.
const kinds={
  demand:['rowIndex','villageId','villageName','pickupId','pickupName','pickupDisposition','locationNodeId','longitude','latitude','coordinateSystem','people','assistancePeople','wheelchairPeople','groupPolicy','intent','evidence','text'],
  staff:['id','role','available','intent','targetId','evidence'],
  vehicle:['id','name','vehicleType','type','model','totalCapacity','capacity','wheelchairSlots','wheelchair','start','available','driverId','escortIds','notes','intent','targetId','evidence'],
  shelter:['id','name','nodeId','capacity','available','intent','targetId','evidence']
};
const cleanText=(x,max=200)=>typeof x==='string'?x.slice(0,max):'';
const clone=x=>JSON.parse(JSON.stringify(x));
function rows(values,kind){
  if(!Array.isArray(values))return [];
  if(values.length>150)throw Error('录入来源记录超出单批限制，请拆分提交');
  return values.map(row=>Object.fromEntries(kinds[kind].filter(key=>row&&Object.hasOwn(row,key)).map(key=>{
    const value=row[key];return [key,value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)?value:Array.isArray(value)?value.slice(0,30).map(v=>cleanText(v,80)):cleanText(value,key==='text'||key==='evidence'?2000:500)];
  })));
}
function normalize(input){
  if(!input||typeof input!=='object'||!Object.hasOwn(kinds,input.kind))throw Error('录入来源记录类型无效');
  const kind=input.kind,modelRows=rows(input.modelRows,kind),normalizedRows=rows(input.normalizedRows,kind),confirmedRows=rows(input.confirmedRows,kind);
  const source=['voice','text','file','manual'].includes(input.source)?input.source:'manual';
  const online=input.provider==='deepseek'&&input.mode==='online';
  const changes=[],key=(row,i)=>kind==='demand'?'row:'+(row.rowIndex??i+1):'id:'+(row.targetId||row.id||row.nodeId||i+1),original=new Map(normalizedRows.map((r,i)=>[key(r,i),r])),confirmedKeys=new Set();
  for(let index=0;index<confirmedRows.length;index++){
    const row=confirmedRows[index],rowKey=key(row,index),old=original.get(rowKey);confirmedKeys.add(rowKey);
    if(!old)continue;
    for(const field of kinds[kind]){
      if(['rowIndex','text','evidence'].includes(field)||!Object.hasOwn(row,field))continue;
      const before=old[field]??null,after=row[field];
      if(JSON.stringify(before)!==JSON.stringify(after))changes.push({row:index+1,rowKey,field,before,after});
    }
  }
  return {schemaVersion:1,kind,source,provider:online?'deepseek':input.provider==='offline'?'offline':'manual',mode:online?'online':'offline',model:online?cleanText(input.model,100):'',requestId:cleanText(input.requestId,100),at:cleanText(input.at,40),utterance:cleanText(input.utterance,8000),reason:cleanText(input.reason,300),sent:input.sent===true,modelRows,normalizedRows,confirmedRows,changes,reviewIssues:(Array.isArray(input.reviewIssues)?input.reviewIssues:[]).slice(0,150).map(issue=>typeof issue==='string'?cleanText(issue,500):{field:cleanText(issue?.field,50),code:cleanText(issue?.code,80),message:cleanText(issue?.message,500)}),attestation:'reviewed-client-provenance'};
}
function append(data,{name,payload={},before,at=new Date().toISOString()}){
  if(!['command-intake','village-report','configure-resources'].includes(name))return;
  const incoming=payload.semanticAudit;
  if(incoming===undefined)return;
  const list=Array.isArray(incoming)?incoming:[incoming];
  if(list.length>30)throw Error('一次最多保存 30 批录入来源，请分批保存');
  const accepted=list.map(normalize);
  const previous=data.intakeAudit||[],ids=new Set((before?.villageReports||[]).map(r=>r.id));
  const reportIds=(data.villageReports||[]).filter(r=>!ids.has(r.id)).map(r=>r.id);
  const entries=accepted.map((item,i)=>({...item,id:'IA-'+(data.revision+1)+'-'+(previous.length+i+1),action:name,savedAt:at,revision:data.revision+1,exerciseId:data.exerciseId,reportIds,reporter:cleanText(payload.reporter||'指挥值守',40)}));
  const next=[...previous,...entries];
  if(next.length>500||JSON.stringify(next).length>2000000)throw Error('本场录入来源记录已达保存上限，请先结束并归档本场');
  data.intakeAudit=next;
  for(const report of data.villageReports||[])if(reportIds.includes(report.id))report.intakeAuditIds=entries.map(e=>e.id);
}
function validate(data){
  if(data.intakeAudit===undefined)return;
  if(!Array.isArray(data.intakeAudit)||data.intakeAudit.length>500||JSON.stringify(data.intakeAudit).length>2000000)throw Error('存档录入来源记录无效');
  data.intakeAudit=data.intakeAudit.map(value=>({...normalize(value),id:cleanText(value.id,100),action:cleanText(value.action,50),savedAt:cleanText(value.savedAt,40),revision:Number.isSafeInteger(value.revision)?value.revision:0,exerciseId:cleanText(value.exerciseId,100),reporter:cleanText(value.reporter,40),reportIds:(Array.isArray(value.reportIds)?value.reportIds:[]).slice(0,150).map(v=>cleanText(v,80))}));
}
module.exports={append,normalize,validate};
