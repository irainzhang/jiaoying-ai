import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {validateSemanticInput,validateSemanticOutput} from '../semantic-gateway.mjs';
const require=createRequire(import.meta.url),demand=require('../dist/semantic-demand.js'),client=require('../dist/semantic-intake.js');
const data={villages:[{id:'VA',name:'甲村',pickups:[{id:'PA1',name:'甲村礼堂',node:'H1'}]}],scenario:{nodes:[{id:'H1'}],edges:[]}};
const scope={villageId:'VA',pickupId:'PA1'};
const output=(kind,utterance,row,context={})=>validateSemanticOutput({rows:[{...row,evidence:utterance}],warnings:[]},{kind,utterance,context});

test('a plausible but unsupported 30 cannot replace the explicit three in model output',()=>{
  const utterance='甲村新增三个人',result=output('demand',utterance,{people:30,intent:'increment'});
  assert.equal(result.rows[0].people,null);assert.equal(result.rows[0].validationIssues[0].modelValue,30);
  const normalized=demand.normalize(result,{data,scope,utterance});assert.equal(normalized.rows[0].people,null);assert.equal(normalized.reviewIssues[0].field,'people');
  assert.equal(demand.quick(result,{data,scope,utterance}).proposal,null);
  // A corrected human value remains editable in the ordinary review table.
  normalized.rows[0].people=3;assert.equal(normalized.reviewIssues.filter(x=>normalized.rows[x.rowIndex][x.field]==null).length,0);
});

test('multiple numbers and explicit correction retain independently supported values',()=>{
  const result=output('demand','甲村新增二十三人，其中两人需要协助，一人需要轮椅，人数改为二十五人',{people:25,assistancePeople:2,wheelchairPeople:1,intent:'increment'});
  assert.equal(result.rows[0].people,25);assert.equal(result.rows[0].assistancePeople,2);assert.equal(result.rows[0].wheelchairPeople,1);assert.deepEqual(result.rows[0].validationIssues,[]);
  const zero=output('demand','新增10人，无需协助，没有轮椅',{people:10,assistancePeople:0,wheelchairPeople:0,intent:'increment'});
  assert.equal(zero.rows[0].assistancePeople,0);assert.equal(zero.rows[0].wheelchairPeople,0);
  const old=output('demand','甲村新增十人，人数更正为十二人',{people:10,intent:'increment'});assert.equal(old.rows[0].people,null);
  const approximate=output('demand','甲村新增大约十人',{people:10,intent:'increment'});assert.equal(approximate.rows[0].people,null);
});

test('capacity evidence counts all seats and never treats passenger demand as total vehicle capacity',()=>{
  const row={totalCapacity:19,wheelchairSlots:2,driverId:'D01',escortIds:['E01']};
  const good=output('vehicle','19座中巴（含工作人员），司机D01，随车E01，有2个轮椅位',row);
  assert.equal(good.rows[0].totalCapacity,19);assert.equal(good.rows[0].wheelchairSlots,2);assert.deepEqual(good.rows[0].validationIssues,[]);
  const passengers=output('vehicle','车辆可接19人',{totalCapacity:19});assert.equal(passengers.rows[0].totalCapacity,null);assert.equal(passengers.rows[0].validationIssues[0].field,'totalCapacity');
});

test('unknown, cancelled and negative location phrases never inherit a previously chosen pickup',()=>{
  for(const suffix of ['接人点不确定','集合地点还没确定','不在原来的集合点','别用之前的集合点','地点待确认']){
    const utterance='新增六人，'+suffix;
    for(const useGateway of [false,true]){
      const raw={intent:'increment',people:6,villageName:null,pickupName:null,evidence:'新增六人'};
      const response=useGateway?validateSemanticOutput({rows:[raw],warnings:[]},{kind:'demand',utterance,context:{}}):{rows:[raw]};
      const parsed=demand.normalize(response,{data,scope,utterance});assert.equal(parsed.rows[0].pickupId,'',suffix);assert.equal(parsed.rows[0].pickupName,'',suffix);assert.equal(parsed.rows[0].villageId,'VA');
    }
  }
});

test('explicit model disposition protects unfamiliar phrases while here still inherits a selected location',()=>{
  const utterance='这里新增六人',base={people:6,intent:'increment',evidence:utterance};
  assert.equal(demand.normalize({rows:[base]},{data,scope,utterance}).rows[0].pickupId,'PA1');
  for(const pickupDisposition of ['unknown','rejected'])assert.equal(demand.normalize({rows:[{...base,pickupDisposition}]},{data,scope,utterance}).rows[0].pickupId,'');
});

test('resource updates preserve only spoken fields and carry an explicit target and operation',()=>{
  const context={staff:[{id:'D01',role:'driver',available:true}]};
  const result=output('staff','D01今天没到岗',{id:'D01',role:null,available:false,intent:'disable',targetId:'D01',explicitFields:['id','available']},context);
  assert.equal(result.rows[0].role,null);assert.equal(result.rows[0].available,false);assert.equal(result.rows[0].targetId,'D01');assert.equal(result.rows[0].intent,'disable');assert.deepEqual(result.rows[0].explicitFields,['id','available']);
  const invented=output('staff','D01今天没到岗',{id:'D01',role:'driver',available:true,intent:'update',targetId:'D01'},context);
  assert.equal(invented.rows[0].role,null);assert.equal(invented.rows[0].available,null);assert.equal(invented.rows[0].validationIssues.length,2);
  const cleared=output('vehicle','V01清空司机并移除所有随车人员',{id:'V01',driverId:'',escortIds:[],intent:'update',targetId:'V01'});
  assert.equal(cleared.rows[0].driverId,'');assert.deepEqual(cleared.rows[0].escortIds,[]);
});

test('invented resource identity and unmentioned target are left unresolved',()=>{
  const result=output('staff','D01司机已到岗',{id:'D99',role:'driver',available:true,intent:'update',targetId:'D99'});
  assert.equal(result.rows[0].id,null);assert.equal(result.rows[0].targetId,null);assert.ok(result.rows[0].validationIssues.length>=2);
});

test('resource context sends only minimal identity and availability rather than whole resource records',()=>{
  const safe=client.safeContext({vehicles:[{id:'V1',name:'车辆',available:true,totalCapacity:19,apiKey:'hidden'}],shelters:[{nodeId:'S1',name:'安置点',available:false,coordinates:[120,27]}]});
  assert.deepEqual(safe.vehicles,[{id:'V1',name:'车辆',available:true}]);assert.deepEqual(safe.shelters,[{id:'S1',name:'安置点',available:false}]);
  assert.equal(validateSemanticInput({kind:'vehicle',utterance:'V1停用',context:safe}).context.vehicles[0].id,'V1');
});

test('audit provenance is bounded, whitelisted and separates model suggestions from human corrections',()=>{
  const semantic={kind:'demand',mode:'online',provider:'deepseek',model:'fixture',requestId:'req-1',at:'2026-10-06T00:00:00Z',utterance:'甲村新增三人',modelRows:[{people:30,apiKey:'never-persist'}],normalizedRows:[{people:null}],reviewIssues:[{rowIndex:0,field:'people',code:'number-unverified',message:'请核对',modelValue:30}],sent:true,apiKey:'never-persist'};
  const audit=client.auditRecord(semantic,[{people:3,apiKey:'never-persist',publish:true}],{source:'voice'});
  assert.equal(audit.provider,'deepseek');assert.equal(audit.source,'voice');assert.equal(audit.modelRows[0].people,30);assert.equal(audit.confirmedRows[0].people,3);assert.deepEqual(audit.changes,[{rowIndex:0,rowKey:'position:0',field:'people',before:null,after:3}]);assert.doesNotMatch(JSON.stringify(audit),/never-persist|apiKey|publish/);
  assert.equal(client.auditRecord(null,[{people:3}],{source:'file',kind:'demand'}).provider,'file');
  const fallback=client.auditRecord({...semantic,mode:'offline',provider:'offline'},[{people:3}]);assert.equal(fallback.provider,'offline');assert.deepEqual(fallback.modelRows,[]);assert.equal(fallback.model,'');
});

test('deleting or reordering a review row neither reassigns its issue nor corrupts audit differences',()=>{
  const parsed={rows:[{rowIndex:1,people:null},{rowIndex:2,people:7}],reviewIssues:[{rowIndex:0,rowNumber:1,field:'people',message:'人数待核对'}]};
  assert.equal(demand.unresolvedIssues(parsed).length,1);parsed.rows.shift();assert.equal(demand.unresolvedIssues(parsed).length,0);
  const semantic={kind:'demand',mode:'online',provider:'deepseek',normalizedRows:[{rowIndex:1,people:3},{rowIndex:2,people:7},{rowIndex:3,people:8}]};
  const audit=client.auditRecord(semantic,[{rowIndex:3,people:9},{rowIndex:2,people:7}]);
  assert.deepEqual(audit.changes,[{rowIndex:2,rowKey:'source:3',field:'people',before:8,after:9}]);assert.equal(audit.removedRows[0].row.people,3);assert.equal(audit.removedRows[0].rowKey,'source:1');assert.deepEqual(audit.addedRows,[]);
  const resources=client.auditRecord({kind:'staff',mode:'online',provider:'deepseek',normalizedRows:[{id:'D01',available:true},{id:'D02',available:true}]},[{id:'D02',available:false}],{kind:'staff'});
  assert.equal(resources.changes[0].rowKey,'resource:D02');assert.equal(resources.changes[0].field,'available');assert.equal(resources.removedRows[0].row.id,'D01');
});
