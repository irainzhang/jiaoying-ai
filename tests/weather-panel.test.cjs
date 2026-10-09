const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Weather=require('../dist/weather-panel.js');
const sample=(rainfall=20,extra={})=>({data:{weather:{rainfall,level:rainfall>=80?3:rainfall>=50?2:1,unit:'mm',sourceMode:'simulation',updatedAt:'2026-10-05T02:03:04.000Z',...extra}}});

test('reads current weather without changing the input or substituting zero',()=>{
  const state=sample(0),before=JSON.stringify(state),view=Weather.deriveWeather(state);
  assert.equal(view.rainfall,0);assert.equal(view.rainfallText,'0');assert.equal(view.level,1);
  assert.equal(view.windowLabel,'最近 1 小时累计（模拟）');assert.equal(view.apiConnected,false);
  assert.equal(JSON.stringify(state),before);
});
test('level and timestamp describe simulation, using Beijing time',()=>{
  for(const [rain,level] of [[20,1],[50,2],[80,3]]){
    const view=Weather.deriveWeather(sample(rain));
    assert.equal(view.level,level);assert.match(view.levelLabel,/演练等级/);
    assert.match(view.updatedLabel,/10:03:04/);
  }
});
test('missing or invalid rain is shown as unavailable, never coerced to zero',()=>{
  for(const rain of [null,undefined,NaN,Infinity,-1,'50',false]){
    const view=Weather.deriveWeather(sample(20,{rainfall:rain}));
    assert.equal(view.rainfall,null);assert.equal(view.rainfallText,'—');assert.match(view.dataIssue,/有效累计雨量/);
  }
  assert.equal(Weather.deriveWeather({}).level,null);
});
test('rain intensity is not silently converted to an hourly accumulation',()=>{
  const view=Weather.deriveWeather(sample(50,{unit:'mm/h'}));
  assert.equal(view.rainfall,null);assert.match(view.dataIssue,/不能将降水强度/);
});
test('live-weather fields remain a reserved contract and do not claim an active API',()=>{
  const forecast={windowHours:6,accumulationMm:100};
  const view=Weather.deriveWeather(sample(20,{sourceMode:'observed',source:'caiyun',observedAt:'2026-10-05T01:00:00Z',forecast}));
  assert.equal(view.apiConnected,false);assert.equal(view.integration.status,'reserved');
  assert.match(view.sourceLabel,/实时天气接口未接入/);assert.equal(view.integration.forecast,forecast);
});
test('render has accessible rain controls and keeps simulated-source boundaries visible',()=>{
  const html=Weather.render(sample());
  assert.match(html,/id="weather-panel"/);assert.match(html,/aria-labelledby="weather-title"/);
  for(const rain of [20,50,80])assert.match(html,new RegExp('data-ac="weather-demo" data-rain="'+rain+'"'));
  assert.match(html,/data-rain="50"[^>]*>启动雨情演练/);
  assert.match(html,/不是官方预警/);assert.match(html,/模拟雨情用于复核安排/);assert.match(html,/不直接推断积水深度或自动封路/);
});
test('host button helper receives the agreed action and rain value, including disabled state',()=>{
  const calls=[];
  Weather.render(sample(),{disabled:true,btn:(...args)=>{calls.push(args);return'<button></button>';}});
  assert.equal(calls.length,4);
  assert.ok(calls.every(args=>args[1]==='weather-demo'&&args[2].includes('disabled')));
  assert.equal(calls[3][0],'启动雨情演练');assert.match(calls[3][2],/data-rain="50"/);
});
test('weather text is escaped, malformed timestamps are not displayed as trusted observations',()=>{
  const html=Weather.render(sample(20,{trigger:'<img src=x onerror=alert(1)>',updatedAt:'not-a-time'}));
  assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/更新时间待核对/);
});
test('classic script browser export needs no server or external library',()=>{
  const browser={};vm.runInNewContext(fs.readFileSync(require.resolve('../dist/weather-panel.js'),'utf8'),browser);
  assert.equal(typeof browser.JiaoyingWeatherPanel.render,'function');
  assert.equal(typeof browser.JiaoyingWeatherPanel.deriveWeather,'function');
});
