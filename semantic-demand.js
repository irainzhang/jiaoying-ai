/* Model output is an editable suggestion. Existing intake rules still validate it. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./command-intake.js'),require('./place-directory.js'));else root.JiaoyingSemanticDemand=factory(root.JiaoyingCommandIntake,root.JiaoyingPlaceDirectory);})(typeof globalThis!=='undefined'?globalThis:this,function(intake,directory){
  'use strict';
  const text=value=>typeof value==='string'?value.trim():'';
  function pickupUnknown(input,utterance){
    return ['unknown','rejected'].includes(input.pickupDisposition)||/(?:集合(?:地)?点|接人(?:地)?点|位置|点位|地点)[^，,。；;]{0,12}(?:未定|未确定|没确定|不确定|不清楚|不知道|待定|待确认)|(?:还没|尚未|无法|不能|不)(?:确定|确认)[^，,。；;]{0,8}(?:集合(?:地)?点|接人(?:地)?点|位置|地点)|(?:不在|不是|不用|取消|别用|不要沿用|不能沿用)[^，,。；;]{0,12}(?:集合(?:地)?点|接人(?:地)?点|原(?:来)?(?:位置|地点))/.test(utterance);
  }
  function unresolvedIssues(parsed={}){
    const rows=parsed.rows||[];
    return (parsed.reviewIssues||[]).filter(issue=>{
      // rowIndex on a demand row is its original source row number, not its
      // current position in an editable array. A removed row has no issue.
      const row=issue.rowNumber!=null?rows.find(row=>row.rowIndex===issue.rowNumber):rows[issue.rowIndex];
      return !!row&&(row[issue.field]===null||row[issue.field]===undefined||row[issue.field]==='');
    });
  }
  function context(data,scope={},utterance=''){
    const all=directory.villages(data,scope.villageId),selected=all.find(v=>v.id===scope.villageId);
    const ranked=[...all.filter(v=>v.id===scope.villageId||utterance.includes(v.name)),...all];
    const seen=new Set(),villages=[];let remaining=150;
    for(const v of ranked){if(seen.has(v.id)||villages.length>=100)continue;seen.add(v.id);const points=directory.pickups(data,v.id),named=points.filter(p=>p.id===scope.pickupId||utterance.includes(p.name));const chosen=[...named,...(v.id===scope.villageId?points:[])].filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i).slice(0,Math.min(20,remaining));remaining-=chosen.length;villages.push({id:v.id,name:v.name,pickups:chosen.map(p=>({id:p.id,name:p.name}))});}
    const point=selected&&directory.pickups(data,selected.id).find(p=>p.id===scope.pickupId);
    return {villages,scope:{villageId:scope.villageId||'',villageName:selected?.name||scope.villageName||'',pickupId:scope.pickupId||'',pickupName:point?.name||scope.pickupName||''}};
  }
  function normalize(response,{data,scope={},utterance=''}={}){
    if(!response||!Array.isArray(response.rows)||response.rows.length>100)throw Error('语义结果不是有效的需求列表。');
    const errors=[],warnings=[...(response.warnings||[])],reviewIssues=[],known=context(data,scope,utterance).scope;
    const rows=response.rows.map((input,index)=>{
      if(!input||typeof input!=='object'||Array.isArray(input))throw Error('语义需求行格式不正确。');
      if(input.intent!=='increment')errors.push('第 '+(index+1)+' 条不是明确的新增需求；总量、更正或执行进展请使用对应入口，不能自动累计。');
      const number=key=>input[key]==null?null:typeof input[key]==='number'?input[key]:null;
      let row={villageId:'',villageName:'',pickupId:'',pickupName:'',people:number('people'),assistancePeople:number('assistancePeople'),wheelchairPeople:number('wheelchairPeople'),groupPolicy:['splittable','together'].includes(input.groupPolicy)?input.groupPolicy:'unknown',longitude:null,latitude:null,coordinateSystem:null,rowIndex:index+1,text:text(input.evidence)&&utterance.includes(text(input.evidence))?text(input.evidence):utterance};
      const villageName=known.villageId&&(!text(input.villageName)||text(input.villageName)===known.villageName)?known.villageId:text(input.villageName)||known.villageName;
      row=intake.updateRow(row,'villageName',villageName,{data});
      // Only inherit an explicitly selected pickup when the area is unchanged.
      const sameArea=!!known.villageName&&(row.villageName===known.villageName||!!known.villageId&&row.villageId===known.villageId);
      const unknownPickup=pickupUnknown(input,response.rows.length===1?utterance:row.text);
      const pickupName=unknownPickup?'':sameArea&&known.pickupId&&(!text(input.pickupName)||text(input.pickupName)===known.pickupName)?known.pickupId:text(input.pickupName)||(sameArea?known.pickupName:'');
      row=intake.updateRow(row,'pickupName',pickupName,{data});
      delete row.original;delete row.editedFields;
      if(unknownPickup)warnings.push('第 '+(index+1)+' 条已明确地点未知或原地点取消，未沿用旧接人点；请重新选择或稍后定位。');
      for(const issue of input.validationIssues||[])if(issue&&typeof issue.field==='string'&&typeof issue.message==='string')reviewIssues.push({rowIndex:index,rowNumber:row.rowIndex,field:issue.field,code:text(issue.code),message:issue.message,modelValue:issue.modelValue});
      if(!row.villageId)warnings.push('第 '+(index+1)+' 条地区尚未唯一匹配；请搜索选择或填写，未推测地图坐标。');
      return row;
    });
    if(!rows.length)errors.push('没有识别到新增人员需求，请补充人数和地点后重新整理。');
    warnings.push('DeepSeek 结果需核对；未说出的协助、轮椅人数和分组条件保留待补，未自动生成坐标。');
    return {rows,errors:[...new Set(errors)],warnings:[...new Set(warnings)],reviewIssues,sourceText:utterance};
  }
  function quick(response,options={}){
    const parsed=normalize(response,options),review=intake.reviewRows(parsed.rows,{data:options.data});
    const questions=[...parsed.errors,...review.errors,...unresolvedIssues(parsed).map(issue=>issue.message)];
    if(parsed.rows.length!==1)questions.push('现场快速补报一次确认一批人员；多地区需求请分批补报或在指挥台批量录入。');
    const row=review.rows[0];if(row&&!row.villageId)questions.push('请先选择本场已登记的地区，再确认补报。');
    const proposal=!questions.length&&row?{action:'village-report',payload:{villageId:row.villageId,pickupId:row.pickupId||'',mode:'increment',people:row.people,assistancePeople:row.assistancePeople,wheelchairPeople:row.wheelchairPeople,groupPolicy:row.groupPolicy,targetId:'',observedAt:'',scope:'waiting',text:options.utterance,reporter:options.reporter||'现场演示员',source:options.source==='voice'?'voice':'text',duplicateAcknowledged:false}}:null;
    return {intent:proposal?'village-report':'clarify',title:proposal?'待确认：新增人员':'请核对补报内容',summary:proposal?'新增 '+row.people+' 人，确认后送达指挥台。':'尚未写入台账。',questions:[...new Set(questions)],warnings:[...new Set([...parsed.warnings,...review.warnings])],reviewIssues:parsed.reviewIssues,evidence:['由 DeepSeek 整理字段，经过本地业务校验；尚未提交。'],proposal};
  }
  return {context,normalize,quick,unresolvedIssues};
});
