'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../dist/place-picker.js');
const choices=[{id:'V-A',label:'演示村 A',detail:'已登记地区'},{id:'V-B',label:'玉海街道'},{id:'V-C',label:'玉海社区'}];

// Minimal DOM for the event contract; visual geometry is verified in browser QA.
class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.attrs={};this.dataset={};this.handlers={};this.style={};this.value='';this.disabled=false;this.classList={toggle:()=>{}};}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')this.id=String(v);}
  getAttribute(k){return this.attrs[k]??null;}
  removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,fn){(this.handlers[k]??=[]).push(fn);}
  removeEventListener(k,fn){this.handlers[k]=(this.handlers[k]||[]).filter(f=>f!==fn);}
  fire(type,extra={}){const event={target:this,key:'',defaultPrevented:false,propagationStopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.propagationStopped=true;},...extra};for(const fn of [...(this.handlers[type]||[])])fn(event);return event;}
  appendChild(node){node.parent=this;this.children.push(node);return node;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
  contains(node){return this===node||this.children.some(c=>c.contains(node));}
  querySelector(sel){if(sel==='.place-picker-input')return this.input;if(sel==='.place-picker-toggle')return this.toggle;if(sel==='.place-picker-control')return this.control;if(sel==='.place-picker-list')return this.list;return null;}
  querySelectorAll(sel){if(sel==='[data-place-option]')return this.items||[];return [];}
  getBoundingClientRect(){return {width:220,left:30,top:40,bottom:84};}
  focus(){this.fire('focus');}
  scrollIntoView(){this.scrolled=true;}
  closest(sel){return sel==='[data-place-option]'&&this.dataset.placeOption!==undefined?this:null;}
  set innerHTML(value){this.markup=value;this.list=new Element();this.items=[...value.matchAll(/id="([^"]*)" data-place-option="(\d+)"/g)].map(([,id,index])=>{const item=new Element();item.id=id;item.dataset.placeOption=index;return item;});this.children=[this.list,...this.items];for(const node of this.children)node.parent=this;}
  get innerHTML(){return this.markup||'';}
}
function fixture({value='',options=choices,getOptions,disabled=false,controlRect}={}){
  const doc=new Element(),win=new Element(),body=new Element();win.innerWidth=1024;win.innerHeight=768;doc.body=body;doc.defaultView=win;doc.createElement=tag=>new Element(tag);
  const wrapper=new Element(),input=new Element('input'),toggle=new Element('button'),control=new Element();input.id='village';input.value=value;input.disabled=disabled;input.setAttribute('aria-label','地区 / 村庄');wrapper.dataset.placeOptions=JSON.stringify(options);wrapper.input=input;wrapper.toggle=toggle;wrapper.control=control;control.getBoundingClientRect=()=>controlRect||{width:264,left:30,top:40,bottom:86};wrapper.appendChild(control);control.appendChild(input);control.appendChild(toggle);
  const root=new Element();root.ownerDocument=doc;root.querySelectorAll=()=>[wrapper];const commits=[];
  const cleanup=P.bind(root,{getOptions,onCommit:(...args)=>commits.push(args)});
  return {doc,win,root,wrapper,input,toggle,commits,cleanup,portal:()=>body.children[0],type(text){input.value=text;return input.fire('input');},choose(index){const popup=body.children[0];popup.fire('click',{target:popup.items[index]});}};
}

test('search filters actual labels and IDs, normalizes width/case/space, and never fuzzy matches',()=>{
  assert.deepEqual(P.filterOptions(choices,' 玉 海 ').map(x=>x.id),['V-B','V-C']);
  assert.deepEqual(P.filterOptions(choices,'ｖ－ａ').map(x=>x.id),['V-A']);
  assert.deepEqual(P.filterOptions(choices,'雨海'),[]);
  assert.deepEqual(P.filterOptions(choices,'已登记'),[]);
  assert.equal(P.filterOptions(choices,'').length,3);
});

test('HTML safely escapes labels, values, attributes and candidate JSON; exposes accessible combobox',()=>{
  const html=P.html({id:'test-place',label:'地点"<',value:'A" autofocus="bad',options:[{id:'"><script>',label:'<img>'}],attributes:{'data-row':0,'data-intake-field':'villageName',onclick:'bad','aria-label':'override'}});
  assert.match(html,/role="combobox"/);assert.match(html,/aria-autocomplete="list"/);assert.match(html,/aria-controls="test-place-options"/);assert.match(html,/data-row="0"/);assert.doesNotMatch(html,/onclick=|value="A" autofocus=/);assert.match(html,/&lt;img&gt;/);assert.match(html,/地点&quot;&lt;/);
  assert.throws(()=>P.html({}),/唯一 id/);
});

test('focus does not reopen a picker after host render; toggle shows all options even for selected value',()=>{
  const f=fixture({value:'玉海街道'});f.input.focus();assert.equal(f.portal(),undefined);
  f.toggle.fire('click');assert.equal(f.input.getAttribute('aria-expanded'),'true');assert.equal(f.portal().items.length,4);assert.match(f.portal().innerHTML,/演示村 A/);
  f.toggle.fire('click');assert.equal(f.portal(),undefined);assert.equal(f.commits.length,0);f.cleanup();
});

test('typing is locally filtered and never commits or propagates partial input; registered choice is explicit',()=>{
  const f=fixture();const inputEvent=f.type('玉海');assert.equal(inputEvent.propagationStopped,true);assert.equal(f.input.fire('change').propagationStopped,true);assert.equal(f.commits.length,0);assert.equal(f.portal().items.length,3);
  assert.equal(f.input.getAttribute('aria-activedescendant'),null);f.choose(0);
  assert.equal(f.commits.length,1);assert.equal(f.commits[0][1],'玉海街道');assert.equal(f.commits[0][2].id,'V-B');assert.equal(f.commits[0][3].reason,'selection');assert.equal(f.portal(),undefined);
  f.input.fire('blur');assert.equal(f.commits.length,1);f.cleanup();
});

test('manual unknown place can be retained without inventing registered identity or coordinates',()=>{
  const f=fixture();f.type('新溪口集合点');assert.equal(f.portal().items.length,1);assert.match(f.portal().innerHTML,/没有匹配/);assert.match(f.portal().innerHTML,/使用填写内容：新溪口集合点/);assert.match(f.portal().innerHTML,/地图定位/);
  f.choose(0);assert.equal(f.commits[0][1],'新溪口集合点');assert.equal(f.commits[0][2],null);assert.equal(f.commits[0][3].reason,'manual');f.cleanup();
});

test('keyboard navigation chooses a candidate; Enter without navigation retains typed free text',()=>{
  const f=fixture();f.type('玉海');const arrow=f.input.fire('keydown',{key:'ArrowDown'});assert.equal(arrow.defaultPrevented,true);assert.equal(f.input.getAttribute('aria-activedescendant'),'village-choice-0');
  f.input.fire('keydown',{key:'Enter'});assert.equal(f.commits[0][2].id,'V-B');
  f.type('玉海社区');f.input.fire('keydown',{key:'Enter'});assert.equal(f.commits[1][1],'玉海社区');assert.equal(f.commits[1][2],null);assert.equal(f.commits[1][3].reason,'enter');f.cleanup();
});

test('blur and Tab commit edits synchronously once so the next host button reads the updated data',()=>{
  const f=fixture();f.type('  新村  ');f.input.fire('blur',{relatedTarget:new Element('button')});assert.equal(f.commits[0][1],'新村');assert.equal(f.commits[0][3].reason,'blur');
  f.type('新接人点');const tab=f.input.fire('keydown',{key:'Tab'});assert.equal(tab.defaultPrevented,false);assert.equal(f.commits[1][3].reason,'tab');f.input.fire('blur');assert.equal(f.commits.length,2);
  f.type('');f.input.fire('blur');assert.equal(f.commits[2][1],'');f.cleanup();
});

test('IME composition does not prematurely submit text; Escape only closes suggestions',()=>{
  const f=fixture();f.type('玉海');f.input.fire('keydown',{key:'Enter',isComposing:true});assert.equal(f.commits.length,0);assert.ok(f.portal());
  f.input.fire('keydown',{key:'Escape'});assert.equal(f.portal(),undefined);assert.equal(f.input.value,'玉海');assert.equal(f.commits.length,0);f.cleanup();
});

test('getOptions reads current parent scope on opening and typing, even without a full host rerender',()=>{
  let current=choices;const f=fixture({getOptions:()=>current});f.toggle.fire('click');assert.match(f.portal().innerHTML,/演示村 A/);
  current=[{id:'P-NEW',label:'新选地区接人点'}];f.type('接人');assert.match(f.portal().innerHTML,/新选地区接人点/);assert.doesNotMatch(f.portal().innerHTML,/演示村 A/);f.choose(0);assert.equal(f.commits[0][2].id,'P-NEW');f.cleanup();
});

test('fixed body portal is outside overflow table; outside click closes and cleanup removes every listener',()=>{
  const f=fixture();f.toggle.fire('click');const portal=f.portal();assert.equal(portal.parent,f.doc.body);assert.equal(portal.style.left,'30px');assert.equal(portal.style.width,'280px');
  f.doc.fire('pointerdown',{target:new Element()});assert.equal(f.portal(),undefined);f.toggle.fire('click');f.cleanup();f.cleanup();assert.equal(f.portal(),undefined);assert.equal(Object.values(f.win.handlers).flat().length,0);assert.equal(Object.values(f.input.handlers).flat().length,0);f.toggle.fire('click');assert.equal(f.portal(),undefined);
});

test('disabled picker does not open or change host data',()=>{const f=fixture({disabled:true});f.toggle.fire('click');assert.equal(f.portal(),undefined);assert.equal(f.commits.length,0);f.cleanup();});

test('popup anchors to the full input and toggle control, and stays inside a resized mobile viewport',()=>{
  const f=fixture({controlRect:{width:520,left:90,top:40,bottom:86}});f.toggle.fire('click');
  assert.equal(f.portal().style.width,'520px');assert.equal(f.portal().style.left,'90px');assert.equal(f.portal().style.top,'92px');
  f.win.innerWidth=390;f.win.fire('resize');assert.equal(f.portal().style.width,'366px');assert.equal(f.portal().style.left,'12px');
  assert.equal(f.input.getAttribute('aria-expanded'),'true');f.input.fire('keydown',{key:'ArrowDown'});f.input.fire('keydown',{key:'Enter'});assert.equal(f.commits[0][2].id,'V-A');f.cleanup();
});
