'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../dist/place-picker.js');

// Event and portal ownership fixture; no browser-specific layout is simulated.
class Element{
  constructor(){this.children=[];this.attrs={};this.dataset={};this.handlers={};this.style={};this.value='';this.classList={toggle(){}};}
  setAttribute(k,v){this.attrs[k]=String(v);}
  getAttribute(k){return this.attrs[k]??null;}
  removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,fn){(this.handlers[k]??=[]).push(fn);}
  removeEventListener(k,fn){this.handlers[k]=(this.handlers[k]||[]).filter(x=>x!==fn);}
  fire(type,extra={}){const e={target:this,preventDefault(){},stopPropagation(){},...extra};for(const fn of [...(this.handlers[type]||[])])fn(e);return e;}
  appendChild(node){node.parent=this;this.children.push(node);return node;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null;}
  contains(node){return this===node||this.children.some(c=>c.contains(node));}
  closest(selector){if(selector==='[data-place-option]'&&this.dataset.placeOption!==undefined)return this;if(selector==='dialog[open]'&&this.isOpenDialog)return this;return this.parent?.closest(selector)||null;}
  querySelector(selector){return {'.place-picker-input':this.input,'.place-picker-toggle':this.toggle,'.place-picker-control':this.control,'.place-picker-list':this.list}[selector]||null;}
  querySelectorAll(selector){return selector==='[data-place-option]'?this.items||[]:[];}
  focus(){}
  scrollIntoView(){}
  getBoundingClientRect(){return {width:280,left:30,top:40,bottom:86};}
  set innerHTML(value){this.markup=value;this.list=new Element();this.items=[...value.matchAll(/id="([^"]*)" data-place-option="(\d+)"/g)].map(([,id,index])=>{const el=new Element();el.id=id;el.dataset.placeOption=index;return el;});this.children=[this.list,...this.items];for(const el of this.children)el.parent=this;}
  get innerHTML(){return this.markup||'';}
}
function fixture({noun='司机',allowCustom=false,inDialog=false}={}){
  const doc=new Element(),win=new Element(),body=new Element(),dialog=new Element();doc.body=body;doc.defaultView=win;doc.createElement=()=>new Element();win.innerWidth=1024;win.innerHeight=768;dialog.isOpenDialog=inDialog;
  const wrapper=new Element(),input=new Element(),toggle=new Element(),control=new Element();input.id='crew';input.setAttribute('aria-label','司机编号');wrapper.input=input;wrapper.toggle=toggle;wrapper.control=control;wrapper.dataset={placeNoun:noun,placeAllowCustom:String(allowCustom),placeOptions:JSON.stringify([{id:'D01',label:'司机 D01'},{id:'D02',label:'司机 D02'}])};wrapper.appendChild(control);control.appendChild(input);control.appendChild(toggle);if(inDialog)dialog.appendChild(wrapper);
  const root=new Element();root.ownerDocument=doc;root.querySelectorAll=()=>[wrapper];const commits=[];const cleanup=P.bind(root,{onCommit:(...args)=>commits.push(args)});
  const host=inDialog?dialog:body;
  return {doc,body,dialog,input,toggle,commits,cleanup,portal:()=>host.children.find(x=>x.className==='place-picker-popup'),type(text){input.value=text;input.fire('input');}};
}

test('default picker HTML remains a free-entry place selector',()=>{
  const html=P.html({id:'place'});assert.match(html,/placeholder="搜索名称 \/ 编号，或手动填写"/);assert.match(html,/aria-label="展开地点候选地点"/);assert.match(html,/data-place-allow-custom="true"/);
});

test('business noun and restricted choices change placeholder and label with safe escaping',()=>{
  const html=P.html({id:'driver',label:'司机编号',noun:'司机',allowCustom:false});assert.match(html,/搜索司机名称 \/ 编号，从候选中选择/);assert.match(html,/展开司机编号候选司机/);assert.doesNotMatch(html,/地点|手动填写/);
  const escaped=P.html({id:'model',noun:'型号<script>',placeholder:'自定义提示'});assert.match(escaped,/型号&lt;script&gt;/);assert.doesNotMatch(escaped,/<script>/);assert.match(escaped,/placeholder="自定义提示"/);
});

test('restricted picker omits manual candidate and keeps unresolved input for business validation',()=>{
  const f=fixture();f.type('不存在');assert.match(f.portal().innerHTML,/没有匹配的已登记司机/);assert.match(f.portal().innerHTML,/从候选中选择/);assert.doesNotMatch(f.portal().innerHTML,/新地点|使用填写内容|地图定位/);assert.equal(f.portal().items.length,0);
  f.input.fire('keydown',{key:'ArrowDown'});f.input.fire('keydown',{key:'Enter'});assert.equal(f.input.value,'不存在');assert.equal(f.commits[0][1],'不存在');assert.equal(f.commits[0][2],null);assert.equal(f.commits[0][3].reason,'enter');f.cleanup();
});

test('custom business values use their own noun rather than place-specific guidance',()=>{
  const f=fixture({noun:'车型',allowCustom:true});f.type('增援车型');assert.match(f.portal().innerHTML,/可直接填写新车型/);assert.match(f.portal().innerHTML,/未登记车型保留填写内容/);assert.doesNotMatch(f.portal().innerHTML,/地点|地图定位/);assert.equal(f.portal().items.length,1);f.cleanup();
});

test('picker portal belongs to open dialog and cleans up when the dialog closes',()=>{
  const f=fixture({inDialog:true});f.toggle.fire('click');assert.equal(f.portal().parent,f.dialog);assert.equal(f.body.children.length,0);assert.equal(f.dialog.handlers.close.length,1);
  f.dialog.fire('close');assert.equal(f.portal(),undefined);assert.equal(f.input.getAttribute('aria-expanded'),'false');assert.equal(f.dialog.handlers.close.length,0);assert.equal(f.commits.length,0);
  f.toggle.fire('click');assert.equal(f.dialog.handlers.close.length,1);f.cleanup();f.cleanup();assert.equal(f.portal(),undefined);assert.equal(f.dialog.handlers.close.length,0);assert.equal(Object.values(f.input.handlers).flat().length,0);
});

test('restricted keyboard selection still returns the original candidate protocol',()=>{
  const f=fixture();f.type('D02');assert.equal(f.portal().parent,f.body);assert.equal(f.portal().items.length,1);f.input.fire('keydown',{key:'ArrowDown'});assert.equal(f.input.getAttribute('aria-activedescendant'),'crew-choice-0');f.input.fire('keydown',{key:'Enter'});
  assert.equal(f.commits.length,1);assert.equal(f.commits[0][0],f.input);assert.equal(f.commits[0][1],'司机 D02');assert.equal(f.commits[0][2].id,'D02');assert.equal(f.commits[0][3].reason,'selection');assert.equal(f.portal(),undefined);f.cleanup();
});
