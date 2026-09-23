(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JiaoyingEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const initial = {
    name: '青岚镇',
    nodes: [
      { id: 'D', x: 112, y: 290, label: '车辆集结点', kind: 'depot' },
      { id: 'W1', x: 238, y: 176, label: '西山路口', kind: 'junction' },
      { id: 'W2', x: 250, y: 388, label: '南环路口', kind: 'junction' },
      { id: 'B1', x: 398, y: 220, label: '东桥西', kind: 'junction' },
      { id: 'B2', x: 510, y: 220, label: '东桥东', kind: 'junction' },
      { id: 'N1', x: 394, y: 82, label: '北桥西', kind: 'junction' },
      { id: 'N2', x: 512, y: 82, label: '北桥东', kind: 'junction' },
      { id: 'E', x: 627, y: 334, label: '东岭路口', kind: 'junction' },
      { id: 'H1', x: 155, y: 93, label: '01 松林户', kind: 'home' },
      { id: 'H2', x: 327, y: 127, label: '02 石桥户', kind: 'home' },
      { id: 'H3', x: 558, y: 140, label: '03 东岭户', kind: 'home' },
      { id: 'H4', x: 708, y: 223, label: '04 河畔户', kind: 'home' },
      { id: 'H5', x: 558, y: 428, label: '05 南湾户', kind: 'home' },
      { id: 'H6', x: 146, y: 458, label: '06 榆树户', kind: 'home' },
      { id: 'S1', x: 326, y: 478, label: '青岚学校', kind: 'shelter' },
      { id: 'S2', x: 730, y: 407, label: '东岭体育馆', kind: 'shelter' }
    ],
    edges: [
      ['D','W1',4], ['D','W2',4], ['W1','H1',3], ['W1','H2',3],
      ['W1','B1',4], ['W1','N1',6], ['W2','B1',5], ['W2','H6',3],
      ['W2','S1',4], ['H6','S1',5], ['H2','N1',3], ['B1','N1',5],
      ['N1','N2',7,'north'], ['B1','B2',3,'east'], ['N2','H3',3],
      ['B2','H3',3], ['B2','E',4], ['H3','H4',5], ['E','H4',3],
      ['E','H5',3], ['E','S2',4], ['H5','S2',5]
    ].map((e, i) => ({ id: e[3] || `r${i}`, from: e[0], to: e[1], minutes: e[2], open: true })),
    households: [
      { id: 'H1', name: '松林户', people: 2, priority: 3, assistance: false, wheelchair: false, service: 2, note: '演练设定：需优先转移', response: '待联系' },
      { id: 'H2', name: '石桥户', people: 3, priority: 2, assistance: true, wheelchair: true, service: 6, note: '含 1 名轮椅使用者及 2 名同行者', response: '已通知' },
      { id: 'H3', name: '东岭户', people: 4, priority: 1, assistance: false, wheelchair: false, service: 2, note: '4 人同车转移', response: '已通知' },
      { id: 'H4', name: '河畔户', people: 2, priority: 2, assistance: true, wheelchair: false, service: 5, note: '需上门陪同，含同行人员', response: '等待协助' },
      { id: 'H5', name: '南湾户', people: 1, priority: 1, assistance: false, wheelchair: false, service: 2, note: '待核实接送需求', response: '待联系' },
      { id: 'H6', name: '榆树户', people: 3, priority: 1, assistance: false, wheelchair: false, service: 2, note: '3 人同车转移', response: '已通知' }
    ],
    vehicles: [
      { id: 'V1', name: '1 号车', capacity: 6, wheelchair: true, color: '#446dff', available: true, start: 'D' },
      { id: 'V2', name: '2 号车', capacity: 5, wheelchair: false, color: '#14a49b', available: true, start: 'D' },
      { id: 'V3', name: '3 号车', capacity: 4, wheelchair: false, color: '#d48c22', available: true, start: 'D' }
    ],
    shelters: [
      { id: 'S1', name: '青岚学校', capacity: 10, available: true },
      { id: 'S2', name: '东岭体育馆', capacity: 12, available: true }
    ]
  };
  function createScenario() { return clone(initial); }
  function validateScenario(s) {
    if (!s || !Array.isArray(s.nodes) || !Array.isArray(s.edges) || !Array.isArray(s.households) || !Array.isArray(s.vehicles) || !Array.isArray(s.shelters)) throw new Error('场景结构不完整');
    if (s.households.length > 8) throw new Error('本演示最多支持 8 户');
    const ids = new Set(s.nodes.map(n => n.id));
    if (ids.size !== s.nodes.length) throw new Error('点位编号必须唯一');
    for (const key of ['edges','vehicles','shelters']) if(new Set(s[key].map(x=>x.id)).size!==s[key].length) throw new Error('资源与道路编号必须唯一');
    for (const e of s.edges) if (!ids.has(e.from) || !ids.has(e.to) || !Number.isFinite(e.minutes) || e.minutes <= 0 || typeof e.open !== 'boolean') throw new Error('道路数据无效');
    const hs = new Set();
    for (const h of s.households) {
      if (hs.has(h.id) || !ids.has(h.id) || !Number.isInteger(h.people) || h.people < 1 || !Number.isInteger(h.priority) || h.priority < 1 || h.priority > 3 || !Number.isFinite(h.service) || h.service < 0 || typeof h.assistance!=='boolean' || typeof h.wheelchair!=='boolean') throw new Error('家庭数据无效');
      hs.add(h.id);
    }
    for (const v of s.vehicles) if (!ids.has(v.start) || !Number.isInteger(v.capacity) || v.capacity < 0 || typeof v.available!=='boolean' || typeof v.wheelchair!=='boolean') throw new Error('车辆数据无效');
    for (const a of s.shelters) if (!ids.has(a.id) || !Number.isInteger(a.capacity) || a.capacity < 0 || typeof a.available!=='boolean') throw new Error('安置点数据无效');
  }
  // Transparent comparison: visit households by priority then ID; append each to
  // the earliest-arriving feasible vehicle. A vehicle keeps its first shelter.
  // This is a declared synthetic baseline, not a measured human dispatch policy.
  function baseline(s) {
    validateScenario(s);
    const started=Date.now(),loads={},routes=s.vehicles.map(v=>({vehicleId:v.id,mask:0,people:0,finish:0,priorityWait:0,totalWait:0,drive:0,stops:[],segments:[],shelterId:null}));
    const order=[...s.households].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
    let combinations=0;
    for(const h of order) {
      let best=null;
      for(let vi=0;vi<s.vehicles.length;vi++) {
        const v=s.vehicles[vi],r=routes[vi];
        if(!v.available||r.people+h.people>v.capacity)continue;
        const chairs=r.stops.filter(st=>s.households.find(x=>x.id===st.id).wheelchair).length+Number(h.wheelchair);
        if(chairs>(v.wheelchair?1:0))continue;
        const lastStop=r.stops.at(-1),from=lastStop?.id||v.start,elapsed=lastStop?.depart||0,leg=shortestPath(s,from,h.id);
        if(!leg)continue;
        for(const sh of s.shelters) {
          if(!sh.available||(r.shelterId&&r.shelterId!==sh.id)||(loads[sh.id]||0)+h.people>sh.capacity)continue;
          const tail=shortestPath(s,h.id,sh.id);if(!tail)continue;
          combinations++;
          const arrival=elapsed+leg.minutes,finish=arrival+h.service+tail.minutes;
          const oldTail=r.stops.length?r.segments.at(-1).minutes:0;
          const route={vehicleId:v.id,mask:r.mask|(1<<s.households.indexOf(h)),people:r.people+h.people,finish,priorityWait:r.priorityWait+(h.priority>1?arrival*h.people:0),totalWait:r.totalWait+arrival*h.people,drive:r.drive-oldTail+leg.minutes+tail.minutes,stops:[...r.stops,{id:h.id,arrival,depart:arrival+h.service,people:h.people}],segments:[...(r.stops.length?r.segments.slice(0,-1):[]),{from,to:h.id,...leg},{from:h.id,to:sh.id,...tail}],shelterId:sh.id};
          if(!best||arrival<best.arrival||(arrival===best.arrival&&finish<best.route.finish))best={vi,arrival,route};
        }
      }
      if(best){routes[best.vi]=best.route;loads[best.route.shelterId]=(loads[best.route.shelterId]||0)+h.people;}
    }
    const mask=routes.reduce((m,r)=>m|r.mask,0),assigned=s.households.filter((h,i)=>mask&(1<<i)),unassigned=s.households.filter((h,i)=>!(mask&(1<<i))).map(h=>({...h,reason:'按本基线的当前分配，无法继续安排；可尝试联合调度'}));
    const sum=key=>routes.reduce((n,r)=>n+r[key],0),priorityPeople=assigned.filter(h=>h.priority>1).reduce((n,h)=>n+h.people,0);
    return {mask,routes,servedPeople:sum('people'),totalPeople:s.households.reduce((n,h)=>n+h.people,0),totalHouseholds:s.households.length,servedHouseholds:assigned.length,urgent:assigned.filter(h=>h.priority===3).length,assisted:assigned.filter(h=>h.priority===2).length,priorityWait:sum('priorityWait'),totalWait:sum('totalWait'),priorityAverage:priorityPeople?sum('priorityWait')/priorityPeople:0,finish:Math.max(0,...routes.map(r=>r.finish)),drive:sum('drive'),unassigned,complete:!unassigned.length,combinations,elapsedMs:Date.now()-started};
  }
  function shortestPath(s, start, end) {
    const dist = {}, previous = {}, unvisited = new Set(s.nodes.map(n => n.id));
    for (const n of unvisited) dist[n] = Infinity;
    if (!unvisited.has(start) || !unvisited.has(end)) return null;
    dist[start] = 0;
    while (unvisited.size) {
      let u = null;
      for (const id of unvisited) if (u === null || dist[id] < dist[u]) u = id;
      if (!Number.isFinite(dist[u])) break;
      if (u === end) break;
      unvisited.delete(u);
      for (const e of s.edges) {
        if (!e.open) continue;
        const v = e.from === u ? e.to : !e.directed && e.to === u ? e.from : null;
        if (v === null || !unvisited.has(v)) continue;
        const nd = dist[u] + e.minutes;
        if (nd < dist[v]) { dist[v] = nd; previous[v] = { from: u, edge: e.id }; }
      }
    }
    if (!Number.isFinite(dist[end])) return null;
    const nodes = [end], edges = [];
    let at = end;
    while (at !== start) {
      const p = previous[at];
      if (!p) return null;
      edges.unshift(p.edge); nodes.unshift(p.from); at = p.from;
    }
    return { nodes, edges, minutes: dist[end] };
  }
  function permutations(values) {
    if (values.length < 2) return [values];
    return values.flatMap((v, i) => permutations(values.filter((_, j) => j !== i)).map(rest => [v, ...rest]));
  }
  function solve(s) {
    validateScenario(s);
    const started = Date.now();
    const hs = s.households, all = (1 << hs.length) - 1;
    const lookup = new Map();
    function path(a,b) {
      const key = a + ':' + b;
      if (!lookup.has(key)) lookup.set(key, shortestPath(s,a,b));
      return lookup.get(key);
    }
    const subset = Array.from({ length: all + 1 }, (_, mask) => {
      const people = hs.filter((h,i) => mask & (1 << i));
      return { mask, households: people, people: people.reduce((a,h) => a+h.people,0), urgent: people.filter(h=>h.priority===3).length, assisted: people.filter(h=>h.priority===2).length };
    });
    const options = s.vehicles.map(v => {
      const list = [{ vehicleId:v.id,mask:0,people:0,finish:0,priorityWait:0,totalWait:0,drive:0,stops:[],segments:[],shelterId:null }];
      if (!v.available) return list;
      for (let mask=1; mask<=all; mask++) {
        const sub = subset[mask];
        if (sub.people>v.capacity || sub.households.filter(h=>h.wheelchair).length>(v.wheelchair?1:0)) continue;
        for (const sh of s.shelters) {
          if (!sh.available || sub.people>sh.capacity) continue;
          let best = null;
          for (const order of permutations(sub.households)) {
            let current=v.start, elapsed=0, drive=0, priorityWait=0,totalWait=0, valid=true;
            const stops=[],segments=[];
            for (const h of order) {
              const leg=path(current,h.id);
              if (!leg) {valid=false;break;}
              elapsed+=leg.minutes; drive+=leg.minutes;
              priorityWait += h.priority>1 ? elapsed*h.people : 0;
              totalWait += elapsed*h.people;
              stops.push({id:h.id,arrival:elapsed,depart:elapsed+h.service,people:h.people});
              segments.push({from:current,to:h.id,...leg});
              elapsed+=h.service;current=h.id;
            }
            if (!valid) continue;
            const last=path(current,sh.id);
            if (!last) continue;
            elapsed+=last.minutes;drive+=last.minutes;
            segments.push({from:current,to:sh.id,...last});
            const option={vehicleId:v.id,mask,people:sub.people,finish:elapsed,priorityWait,totalWait,drive,stops,segments,shelterId:sh.id};
            if (!best || priorityWait<best.priorityWait || (priorityWait===best.priorityWait && elapsed<best.finish) || (priorityWait===best.priorityWait && elapsed===best.finish && totalWait<best.totalWait)) best=option;
          }
          if (best) list.push(best);
        }
      }
      return list;
    });
    let best=null, combinations=0;
    function better(a,b) {
      if (!b) return true;
      const av=[-a.urgent,-a.assisted,-a.servedPeople,a.priorityWait,a.finish,a.drive,a.totalWait];
      const bv=[-b.urgent,-b.assisted,-b.servedPeople,b.priorityWait,b.finish,b.drive,b.totalWait];
      for(let i=0;i<av.length;i++) if(av[i]!==bv[i]) return av[i]<bv[i];
      return false;
    }
    function walk(vi,mask,loads,routes,pWait,tWait,finish,drive) {
      if(vi===options.length) {
        combinations++;
        const covered=subset[mask];
        const result={mask,servedPeople:covered.people,urgent:covered.urgent,assisted:covered.assisted,priorityWait:pWait,totalWait:tWait,finish,drive,routes:[...routes]};
        if (better(result,best)) best=result;
        return;
      }
      for (const option of options[vi]) {
        if (option.mask&mask) continue;
        if(option.shelterId) {
          const sh=s.shelters.find(a=>a.id===option.shelterId);
          if ((loads[sh.id]||0)+option.people>sh.capacity) continue;
          loads[sh.id]=(loads[sh.id]||0)+option.people;
        }
        routes.push(option);
        walk(vi+1,mask|option.mask,loads,routes,pWait+option.priorityWait,tWait+option.totalWait,Math.max(finish,option.finish),drive+option.drive);
        routes.pop();
        if(option.shelterId) loads[option.shelterId]-=option.people;
      }
    }
    walk(0,0,{},[],0,0,0,0);
    const assigned=hs.filter((h,i)=>best.mask&(1<<i));
    const unassigned=hs.filter((h,i)=>!(best.mask&(1<<i))).map(h=>{
      const matching=s.vehicles.filter(v=>v.available&&v.capacity>=h.people&&(!h.wheelchair||v.wheelchair));
      let reason='现有车辆或安置容量不足，单趟方案无法覆盖';
      if(!matching.length) reason=h.wheelchair?'没有可用的适配车辆或座位不足':'没有可用车辆或单车座位不足';
      else if(!s.shelters.some(sh=>sh.available&&sh.capacity>=h.people)) reason='没有容量足够的开放安置点';
      else if(!matching.some(v=>path(v.start,h.id)&&s.shelters.some(sh=>sh.available&&sh.capacity>=h.people&&path(h.id,sh.id)))) reason='没有满足当前通行条件的接送路径';
      return {...h,reason};
    });
    const priorityPeople=assigned.filter(h=>h.priority>1).reduce((n,h)=>n+h.people,0);
    return {...best,totalPeople:subset[all].people,totalHouseholds:hs.length,servedHouseholds:assigned.length,unassigned,complete:best.mask===all,priorityAverage:priorityPeople?best.priorityWait/priorityPeople:0,combinations,elapsedMs:Date.now()-started};
  }
  function validatePlan(s,p) {
    const errors=[],seen=new Set(),loads={};
    let served=0;
    for(const route of p.routes) {
      const v=s.vehicles.find(v=>v.id===route.vehicleId);
      if(!route.stops.length) continue;
      if(!v||!v.available) {errors.push('车辆不可用');continue;}
      const sh=s.shelters.find(sh=>sh.id===route.shelterId);
      if(!sh||!sh.available) errors.push('安置点不可用');
      let onboard=0,wheelchairs=0,elapsed=0,from=v.start;
      route.stops.forEach((stop,i)=>{
        const h=s.households.find(h=>h.id===stop.id),seg=route.segments[i];
        if(!h) {errors.push('家庭不存在');return;}
        if(seen.has(h.id)) errors.push('重复接送');seen.add(h.id);
        if(h.wheelchair&&!v.wheelchair) errors.push('车辆不适配');
        if(h.wheelchair)wheelchairs++;
        onboard+=h.people;served+=h.people;
        if(seg?.from!==from||seg?.to!==h.id) errors.push('接送顺序不一致');
        elapsed+=seg?.minutes||0;
        if(stop.arrival!==elapsed) errors.push('到户时间不一致');
        elapsed+=h.service;from=h.id;
      });
      if(onboard>v.capacity||onboard!==route.people) errors.push('车辆人数不一致或超载');
      if(wheelchairs>(v.wheelchair?1:0)) errors.push('轮椅位不足');
      const last=route.segments[route.segments.length-1];
      if(last?.from!==from||last?.to!==route.shelterId) errors.push('安置终点不一致');
      elapsed+=last?.minutes||0;
      if(elapsed!==route.finish) errors.push('完成时间不一致');
      loads[route.shelterId]=(loads[route.shelterId]||0)+onboard;
      for(const seg of route.segments) {
        let minutes=0;
        if(seg.nodes[0]!==seg.from||seg.nodes[seg.nodes.length-1]!==seg.to||seg.edges.length!==seg.nodes.length-1) errors.push('路径结构无效');
        seg.edges.forEach((id,i)=>{
          const e=s.edges.find(e=>e.id===id);
          if(!e||!e.open) errors.push('路径包含封闭道路');
          if(e&&!((e.from===seg.nodes[i]&&e.to===seg.nodes[i+1])||(e.to===seg.nodes[i]&&e.from===seg.nodes[i+1]))) errors.push('路径不连续');
          minutes+=e?.minutes||0;
        });
        if(minutes!==seg.minutes) errors.push('路段时间不一致');
      }
    }
    for(const sh of s.shelters) if((loads[sh.id]||0)>sh.capacity) errors.push('安置点超容量');
    const unassigned=new Set(p.unassigned.map(h=>h.id));
    for(const h of s.households) if(seen.has(h.id)===unassigned.has(h.id)) errors.push('家庭被遗漏或重复标注');
    if(served!==p.servedPeople) errors.push('方案总人数不一致');
    return [...new Set(errors)];
  }
  function parseReceipt(text) {
    const input=String(text||'').trim();
    if(!input) throw new Error('请先填写现场回执');
    if(input.length>1000) throw new Error('演示回执请控制在 1000 字以内');
    const notNeeded=/不(?:再)?需要|无需/.test(input);
    const needsWheelchair=/轮椅/.test(input)&&!notNeeded;
    const needsAssistance=needsWheelchair||(/需要.*(?:陪同|协助|接送)|行动不便|无法自行|不能自己/.test(input)&&!notNeeded);
    const unresolved=/但|尚未|未到|没到|未安排|没安排|等待|还在等|未落实|没联系上|未联系上/.test(input);
    let status='待人工核实';
    if(/已到达|已抵达|已安置/.test(input)&&!unresolved) status='上报已到达，待核验';
    else if(/已转移|已上车/.test(input)&&!unresolved) status='上报转移进展，待核验';
    else if(/未联系上|没联系上/.test(input)) status='尚未联系上';
    else if(/已通知/.test(input)) status=unresolved||needsAssistance?'已通知，仍需跟进':'已通知';
    else if(/收到/.test(input)) status='已收到，行动未确认';
    return { status, needsAssistance, needsWheelchair, unresolved, completionConfirmed:false, summary:needsWheelchair?'识别到轮椅车辆需求，请核对人员与车辆适配。':needsAssistance?'识别到额外协助需求，请核对陪同与接送安排。':unresolved?'回执仍包含未解决事项，请继续核实。':'仅整理上报状态，不自动认定转移完成。', mode:'rule-demo' };
  }
  return { createScenario, shortestPath, solve, baseline, validatePlan, validateScenario, parseReceipt, clone };
});
