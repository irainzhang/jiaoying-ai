'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dist/entry-kit.js'),'utf8');
function kit(extra={}){const context={TextEncoder,Uint8Array,DataView,Blob,console,...extra};vm.runInNewContext(source,context);return {api:context.JiaoyingEntryKit,context};}
const fields=[{key:'id',label:'编号',type:'text',required:true,maxLength:15},{key:'count',label:'人数',type:'number',required:true,min:0,max:20},{key:'available',label:'可用',type:'boolean',required:true},{key:'role',label:'角色',type:'select',required:true,options:[{value:'driver',label:'司机'},{value:'reserve',label:'机动'}]},{key:'crew',label:'随车人员',type:'list',options:[{value:'W1',label:'W1 工作人员'},{value:'W2',label:'W2 工作人员'}]}];
const schema=()=>({id:'staff',label:'资源',fields,template:{headers:['编号','人数'],rows:[]}});
const row=()=>({id:'W0',count:0,available:false,role:'driver',crew:['W1']});
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};

test('shared controls escape content and preserve host action contracts',()=>{
  const {api}=kit();
  assert.match(api.html({id:'r',kinds:[{value:'staff',label:'工作人员'}]}),/<section id="r".*data-entry-kit="r"/);
  assert.match(api.html({id:'r',title:'<script>',kinds:[{value:'staff',label:'工作人员'}]}),/&lt;script&gt;/);
  assert.doesNotMatch(api.html({id:'r',kinds:[{value:'staff',label:'工作人员'}]}),/data-ac="voice"/);
  assert.match(api.fileHTML({id:'intake-file',templateAction:'intake-template',description:'<img>'}),/id="intake-file"[^>]*accept=".xlsx,.csv"/);
  assert.match(api.fileHTML({id:'x',templateAction:'intake-template'}),/data-ac="intake-template"/);
  const html=api.modesHTML({value:'file',items:[{value:'file',label:'<文件>',attributes:{'data-ac':'file','onclick':'evil()'}}]});
  assert.match(html,/aria-pressed="true"/);assert.match(html,/&lt;文件&gt;/);assert.doesNotMatch(html,/onclick/);
  const voice=api.voiceHTML({state:{supported:true,active:true,phase:'listening',note:'<说明>',preview:'<原话>'},target:'field-agent',activeTarget:'field-agent'});
  assert.match(voice,/data-ac="voice"/);assert.match(voice,/data-ac="voice-cancel"/);assert.match(voice,/结束识别/);assert.match(voice,/&lt;原话&gt;/);
});
test('file and picker wrappers use one implementation and do not reinterpret location values',async()=>{
  const calls=[],{api}=kit({JiaoyingPlacePicker:{html:o=>{calls.push(o);return 'picker';}},JiaoyingIntakeFile:{read:f=>({file:f})}}),config={id:'p',value:'A',options:[]};
  assert.equal(api.pickerHTML(config),'picker');assert.equal(calls[0],config);assert.deepEqual(await api.readFile('file'),{file:'file'});
  assert.match(kit().api.pickerHTML({id:'p',value:'"><script>'}),/&quot;&gt;&lt;script&gt;/);
});
test('normalization preserves blank, numeric zero and false distinctly; validates current candidate options',()=>{
  const {api}=kit();assert.deepEqual(plain(api.normalizeRows(schema(),[row()])),[row()]);
  assert.throws(()=>api.normalizeRows(schema(),[{...row(),count:''}]),/人数不能为空/);
  assert.throws(()=>api.normalizeRows(schema(),[{...row(),available:'false'}]),/明确选择是或否/);
  assert.throws(()=>api.normalizeRows(schema(),[{...row(),count:21}]),/至 20/);
  assert.throws(()=>api.normalizeRows(schema(),[{...row(),role:'no-such-role'}]),/不在当前候选/);
  assert.throws(()=>api.normalizeRows(schema(),[{...row(),crew:['W3']}]),/未识别的候选/);
  assert.throws(()=>api.normalizeRows(schema(),[{...row(),crew:['W1','W1']}]),/重复编号/);
  assert.throws(()=>api.normalizeRows(schema(),[{...row(),id:'x'.repeat(16)}]),/不能超过 15/);
  const optional={fields:[{key:'n',type:'number',label:'未确认数'}]};assert.equal(api.normalizeRows(optional,[{n:''}])[0].n,'');
});
test('unknown parsed options remain visible for correction; list choices are individual checkboxes',()=>{
  const {api}=kit(),html=api.previewHTML(schema(),[{...row(),role:'wrong<role>',crew:['unknown']}],['<警告>']);
  assert.match(html,/待修正：wrong&lt;role&gt;/);assert.match(html,/待修正：unknown/);assert.match(html,/type="checkbox"/);
  assert.match(html,/aria-label="第 1 条 随车人员 W1 工作人员"/);
  assert.match(html,/type="search"/);assert.match(html,/尚未加入草稿/);assert.match(html,/&lt;警告&gt;/);
  assert.doesNotMatch(html,/CSV.*粘贴/);
});

function node(dataset={}){return {dataset,value:'',innerHTML:'',textContent:'',disabled:false,hidden:false,files:[],classList:{toggle(){}},setAttribute(k,v){this[k]=v;},focus(){this.focused=true;},scrollIntoView(){this.scrolled=true;},closest(){return this;}};}
function fixture(overrides={}){
  const nodes=new Map(),actions=new Map(),events={};
  for(const key of ['kind','speech','file','status','error','preview','voice','example','schema-help'])nodes.set(`[data-entry-${key}]`,node());
  nodes.get('[data-entry-kind]').value='staff';
  for(const action of ['cancel','parse','apply','remove','voice','voice-cancel','template'])actions.set(action,node({entryAction:action}));
  const modes=['file','speech'].map(value=>node({entryMode:value})),materials=['file','speech'].map(value=>node({entryMaterial:value}));
  const host={dataset:{entryKit:'resource'},ownerDocument:{},querySelector:s=>nodes.get(s)||actions.get(s.match(/^\[data-entry-action="(.+)"\]$/)?.[1])||null,querySelectorAll:s=>s==='[data-entry-mode]'?modes:s==='[data-entry-material]'?materials:s==='[data-entry-action="cancel"],[data-entry-action="remove"]'?[actions.get('cancel'),actions.get('remove')]:[],addEventListener:(type,fn)=>events[type]=fn,removeEventListener:type=>delete events[type],contains:()=>true};
  let cancels=0,starts=0;const {api,context}=kit({JiaoyingVoice:{create:config=>({state:()=>({supported:true,active:false,note:'语音待命'}),active:()=>false,start(){starts++;},stop(){},cancel(){cancels++;}})},JiaoyingIntakeFile:{read:async()=>({rows:[['编号'],['W0']],warnings:[]})}});
  const applied=[],options={id:'resource',getSchema:schema,parseRows:()=>({rows:[row()],warnings:[]}),parseSpeech:()=>({rows:[row()],warnings:[]}),validate:(_kind,rows)=>rows,onApply:(kind,rows)=>applied.push({kind,rows}),...overrides};
  const dispose=api.bind(host,options),event=target=>({target,preventDefault(){},stopPropagation(){}});
  return {nodes,host,events,actions,modes,api,context,applied,dispose,get cancels(){return cancels;},get starts(){return starts;},
    click:action=>events.click(event(actions.get(action))),mode:value=>events.click(event(modes.find(n=>n.dataset.entryMode===value))),
    async speech(text){const n=nodes.get('[data-entry-speech]');n.value=text;events.input(event(n));await events.click(event(actions.get('parse')));},
    upload(file={name:'resources.xlsx'}){const n=nodes.get('[data-entry-file]');n.files=[file];n.value=file.name;return events.change(event(n));},
    kind(value){const n=nodes.get('[data-entry-kind]');n.value=value;return events.change(event(n));}
  };
}
test('file import only previews; explicit apply appends once and clears pending intake',async()=>{
  const f=fixture();assert.equal(f.starts,0);assert.equal(f.dispose.hasPending(),false);
  await f.upload();assert.equal(f.applied.length,0);assert.equal(f.dispose.hasPending(),true);assert.match(f.nodes.get('[data-entry-preview]').innerHTML,/核对 1 条/);
  await f.click('apply');assert.equal(f.applied.length,1);assert.deepEqual(plain(f.applied[0].rows),[row()]);assert.equal(f.dispose.hasPending(),false);
  await f.click('apply');assert.equal(f.applied.length,1);assert.match(f.nodes.get('[data-entry-status]').textContent,/加入草稿/);
});
test('speech is edited and previewed before applying; cancelling clears pending material without writes',async()=>{
  const f=fixture();await f.mode('speech');await f.speech('工作人员 W0 为司机');assert.equal(f.applied.length,0);assert.equal(f.dispose.hasPending(),true);
  await f.click('cancel');assert.equal(f.dispose.hasPending(),false);assert.equal(f.applied.length,0);assert.equal(f.nodes.get('[data-entry-speech]').value,'');
});

test('typing into the speech text box is recorded as text, while an Excel import stays file provenance',async()=>{
  const applied=[],f=fixture({onApply:(_kind,_rows,meta)=>applied.push(meta)});
  await f.mode('speech');await f.speech('工作人员 W0 为司机');await f.click('apply');
  assert.equal(applied[0].source,'text');assert.equal(applied[0].utterance,'工作人员 W0 为司机');
  await f.mode('file');await f.upload();await f.click('apply');
  assert.equal(applied[1].source,'file');assert.equal(applied[1].utterance,'');
});
test('new type, new file, and disposal discard late file results without resurrecting a preview',async()=>{
  const first=deferred(),second=deferred(),f=fixture();let calls=0;f.context.JiaoyingIntakeFile.read=()=>++calls===1?first.promise:second.promise;
  const p1=f.upload({name:'old.xlsx'});assert.equal(f.dispose.hasPending(),true);await f.click('cancel');await f.kind('vehicle');const p2=f.upload({name:'new.xlsx'});
  first.resolve({rows:[['old']],warnings:[]});await p1;assert.equal(f.nodes.get('[data-entry-preview]').innerHTML,'');
  f.dispose();second.resolve({rows:[['new']],warnings:[]});await p2;assert.equal(f.nodes.get('[data-entry-preview]').innerHTML,'');assert.equal(f.dispose.hasPending(),false);assert.equal(f.applied.length,0);assert.deepEqual(Object.keys(f.events),[]);assert.ok(f.cancels>0);
});
test('late speech error cannot replace messages after switching kinds',async()=>{
  const speech=deferred(),f=fixture({parseSpeech:()=>speech.promise});await f.mode('speech');const pending=f.speech('旧材料');await f.click('cancel');await f.kind('vehicle');speech.reject(new Error('过期错误'));await pending;assert.equal(f.nodes.get('[data-entry-error]').textContent,'');
});
test('semantic request is cancelled on input change and provenance appears only for the current preview',async()=>{
  const late=deferred();let requestSignal;
  const f=fixture({parseSpeech:(_kind,_text,options)=>{requestSignal=options.signal;return late.promise;}});f.context.AbortController=AbortController;
  f.context.JiaoyingSemanticIntake={sourceHTML:meta=>meta?'<p>来源：'+meta.provider+'</p>':''};
  await f.mode('speech');const pending=f.speech('旧原话');assert.equal(requestSignal.aborted,false);
  await f.click('cancel');await f.kind('vehicle');assert.equal(requestSignal.aborted,true);late.resolve({rows:[row()],semantic:{provider:'stale'}});await pending;
  assert.equal(f.nodes.get('[data-entry-preview]').innerHTML,'');
  const g=fixture({parseSpeech:()=>({rows:[row()],semantic:{provider:'DeepSeek'}})});g.context.JiaoyingSemanticIntake=f.context.JiaoyingSemanticIntake;
  await g.mode('speech');await g.speech('新原话');assert.match(g.nodes.get('[data-entry-preview]').innerHTML,/来源：DeepSeek/);assert.equal(g.applied.length,0);
});
test('revalidates dynamic candidates when applying and retains failed preview',async()=>{
  let current=schema();const f=fixture({getSchema:()=>current});await f.upload();current={...schema(),fields:fields.map(x=>x.key==='role'?{...x,options:[]}:x)};
  await f.click('apply');assert.equal(f.applied.length,0);assert.match(f.nodes.get('[data-entry-error]').textContent,/不在当前候选/);assert.equal(f.dispose.hasPending(),true);assert.match(f.nodes.get('[data-entry-preview]').innerHTML,/核对/);
});
test('domain validation and append failures preserve material for correction, without claiming success',async()=>{
  const f=fixture({onApply:()=>{throw new Error('资源已经存在');}});await f.upload();await f.click('apply');assert.match(f.nodes.get('[data-entry-error]').textContent,/资源已经存在/);assert.equal(f.dispose.hasPending(),true);assert.match(f.nodes.get('[data-entry-preview]').innerHTML,/核对/);
});
test('schema-driven labels show required stars and optional hints without changing validation',()=>{
  const {api}=kit(),resource=require('../dist/resource-intake.js'),s=resource.schema('vehicle');
  const name=s.fields.find(f=>f.key==='name'),driver=s.fields.find(f=>f.key==='driverId');
  assert.match(api.fieldLabel(name),/entry-required.*必填.*\*/);
  assert.match(api.fieldLabel(driver),/选填/);assert.doesNotMatch(api.fieldLabel(driver),/entry-required/);
  assert.match(api.fieldHint(driver),/接送.*必须补齐/);
  assert.match(api.schemaHelpHTML(s),/必填.*车辆名称/);assert.match(api.schemaHelpHTML(s),/默认新增/);
  const html=api.previewHTML(s,[{}]);assert.match(html,/aria-required="true"/);assert.match(html,/没有轮椅位填 0/);
  assert.match(api.fieldHint({hint:'<script>'}),/&lt;script&gt;/);
});
test('resource tabs and entry selector switch one type only when there is no pending material',async()=>{
  const changed=[],f=fixture({onKindChange:kind=>changed.push(kind),getSchema:kind=>({...schema(),id:kind,label:kind==='vehicle'?'车辆':'工作人员'})});
  assert.equal(f.dispose.setKind('vehicle'),true);assert.equal(f.nodes.get('[data-entry-kind]').value,'vehicle');assert.deepEqual(changed,['vehicle']);
  assert.match(f.actions.get('template').textContent,/车辆/);assert.match(f.nodes.get('[data-entry-schema-help]').innerHTML,/必填/);
  await f.upload();const before=f.nodes.get('[data-entry-preview]').innerHTML;
  assert.equal(f.dispose.setKind('staff'),false);assert.equal(f.nodes.get('[data-entry-kind]').value,'vehicle');
  assert.match(f.nodes.get('[data-entry-error]').textContent,/先确认加入草稿.*取消本次录入/);
  await f.kind('staff');assert.equal(f.nodes.get('[data-entry-kind]').value,'vehicle');assert.equal(f.nodes.get('[data-entry-preview]').innerHTML,before);
  assert.deepEqual(changed,['vehicle']);await f.click('cancel');await f.kind('staff');assert.deepEqual(changed,['vehicle','staff']);
  f.dispose();assert.equal(f.dispose.setKind('vehicle'),false);
});
test('resource type detection follows clear spreadsheet headers, updates selection and preserves preview',async()=>{
  const resource=require('../dist/resource-intake.js'),changed=[],parsed=[],f=fixture({
    detectKind:resource.detectKind,onKindChange:kind=>changed.push(kind),
    getSchema:kind=>({...schema(),id:kind,label:kind==='vehicle'?'车辆':'工作人员'}),
    parseRows:(kind,rows)=>{parsed.push({kind,rows});return {rows:[row()],warnings:[]};}
  });
  f.context.JiaoyingIntakeFile.read=async()=>({rows:[['车辆型号 *','总核载人数 *'],['小客车',9]],warnings:[]});
  await f.upload({name:'not-a-vehicle-filename.xlsx'});
  assert.deepEqual(changed,['vehicle']);assert.equal(parsed[0].kind,'vehicle');assert.equal(f.nodes.get('[data-entry-kind]').value,'vehicle');
  assert.match(f.nodes.get('[data-entry-preview]').innerHTML,/根据文件表头切换为车辆/);assert.equal(f.applied.length,0);
  assert.equal(f.dispose.hasPending(),true);
});
test('mixed or ambiguous spreadsheet headers never select a guessed resource type',async()=>{
  const resource=require('../dist/resource-intake.js'),changed=[],parsed=[],f=fixture({detectKind:resource.detectKind,onKindChange:k=>changed.push(k),parseRows:k=>{parsed.push(k);return {rows:[row()]};}});
  f.context.JiaoyingIntakeFile.read=async()=>({rows:[['工作人员编号','车辆型号'],['D1','中巴']],warnings:[]});
  await f.upload();assert.match(f.nodes.get('[data-entry-error]').textContent,/混合.*一种资源/);assert.match(f.nodes.get('[data-entry-status]').textContent,/内容整理未完成.*没有加入草稿/);assert.deepEqual(parsed,[]);assert.deepEqual(changed,[]);
  await f.click('cancel');f.context.JiaoyingIntakeFile.read=async()=>({rows:[['编号','名称'],['V1','备用']],warnings:[]});
  await f.upload({name:'车辆.xlsx'});assert.deepEqual(parsed,['staff']);assert.deepEqual(changed,[]);
});
test('file failures stop the reading indicator and stale failures cannot overwrite a newer preview',async()=>{
  const f=fixture();f.context.JiaoyingIntakeFile.read=async()=>{throw new Error('不支持的文件格式');};
  await f.upload();assert.match(f.nodes.get('[data-entry-status]').textContent,/文件读取未完成.*没有加入草稿/);assert.match(f.nodes.get('[data-entry-error]').textContent,/不支持的文件格式/);
  const late=deferred();let calls=0;f.context.JiaoyingIntakeFile.read=()=>++calls===1?late.promise:Promise.resolve({rows:[['编号'],['W0']],warnings:[]});
  const first=f.upload({name:'old.xlsx'});await f.upload({name:'new.xlsx'});const status=f.nodes.get('[data-entry-status]').textContent;
  late.reject(new Error('过期读取错误'));await first;assert.equal(f.nodes.get('[data-entry-status]').textContent,status);assert.equal(f.nodes.get('[data-entry-error]').textContent,'');assert.match(status,/已整理 1 条/);
});
test('asynchronous validation cannot be double-submitted; disposing before it ends blocks apply',async()=>{
  const gate=deferred(),f=fixture({validate:()=>gate.promise});await f.upload();const p=f.click('apply');await f.click('apply');assert.equal(f.actions.get('apply').disabled,true);f.dispose();gate.resolve([row()]);await p;assert.equal(f.applied.length,0);
  const gate2=deferred(),g=fixture({validate:()=>gate2.promise});await g.upload();const p2=g.click('apply');await g.click('apply');gate2.resolve([row()]);await p2;assert.equal(g.applied.length,1);
});

// Minimal fixture DOM sufficient for the production XLSX reader; no runtime dependency.
class Element{constructor(name,attrs={}){this.name=name;this.localName=name.split(':').pop();this.attrs=attrs;this.children=[];this.parts=[];}getAttribute(k){return this.attrs[k]??null;}getAttributeNS(_ns,k){return this.getAttribute('r:'+k);}get textContent(){return this.parts.map(x=>typeof x==='string'?x:x.textContent).join('');}getElementsByTagNameNS(_ns,k){return this.children.flatMap(c=>[...(c.localName===k?[c]:[]),...c.getElementsByTagNameNS('*',k)]);}}
const unxml=s=>s.replace(/&(?:amp|lt|gt|quot|apos);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[x]));
class FixtureParser{parseFromString(xml){const doc=new Element('#document'),stack=[doc];for(const token of xml.match(/<\?[^>]*\?>|<[^>]+>|[^<]+/g)||[]){if(token.startsWith('<?'))continue;if(token.startsWith('</')){stack.pop();continue;}if(token.startsWith('<')){const name=/^<([^\s/>]+)/.exec(token)[1],attributes=Object.fromEntries([...token.matchAll(/([\w:]+)="([^"]*)"/g)].map(x=>[x[1],unxml(x[2])])),n=new Element(name,attributes);stack.at(-1).children.push(n);stack.at(-1).parts.push(n);if(!token.endsWith('/>'))stack.push(n);}else stack.at(-1).parts.push(unxml(token));}doc.documentElement=doc.children[0];return doc;}}
test('real .xlsx template round-trips through production reader; formulas are strings and false/zero survive',async()=>{
  const {api}=kit(),Reader=require('../dist/intake-file.js');
  const headers=['编号','人数','是否可用','备注'],rows=[['演练 W001',0,false,'=HYPERLINK("https://example.org")'],['演练 W002','','','<>&"\' 中文']],bytes=api.xlsxTemplate(headers,rows);
  assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b);const result=await Reader.readXlsx(bytes,{DOMParser:FixtureParser});
  assert.deepEqual(result.rows,[headers,['演练 W001','0','false','=HYPERLINK("https://example.org")'],rows[1]]);assert.match(result.sheetName,/演练示例/);
  const blank=await Reader.readXlsx(api.xlsxTemplate(headers,[]),{DOMParser:FixtureParser});assert.deepEqual(blank.rows,[headers]);
  assert.throws(()=>api.xlsxTemplate([],[]),/列数或行数/);
});
