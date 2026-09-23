'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const E=require('../dist/engine.js');
const X=require('../exercise.cjs');
const G=require('../geo-scenario.cjs');
const network=require('../dist/assets/maps/ruian-routing.json');
const rawPath=path.join(__dirname,'../dist/assets/maps/ruian-osm-raw.json');
const raw=JSON.parse(fs.readFileSync(rawPath,'utf8'));
const ways=new Map(raw.elements.filter(e=>e.type==='way').map(e=>[e.id,e]));
const create=()=>G.apply(X.initial());

test('geographic graph reproduces the attributed bundled source and has no coordinate-only crossings',()=>{
  assert.equal(network.metadata.originalSha256,crypto.createHash('sha256').update(fs.readFileSync(rawPath)).digest('hex'));
  const nodes=new Map(network.nodes.map(node=>[node.id,node]));
  assert.ok(network.metadata.onewayEdges>0);
  for(const edge of network.edges){
    assert.equal(edge.osmWayIds.length,1);
    const way=ways.get(edge.osmWayIds[0]);assert.ok(way);
    assert.equal(edge.osmNodeIds.length,edge.geometry.length);
    assert.equal(nodes.get(edge.from).osmNodeId,edge.osmNodeIds[0]);
    assert.equal(nodes.get(edge.to).osmNodeId,edge.osmNodeIds.at(-1));
    for(let i=0;i<edge.osmNodeIds.length;i++){
      const at=way.nodes.indexOf(edge.osmNodeIds[i]);assert.ok(at>=0);
      const coordinate=way.geometry[at];
      assert.deepEqual(edge.geometry[i],[coordinate.lon,coordinate.lat]);
      if(i){
        const a=edge.osmNodeIds[i-1],b=edge.osmNodeIds[i];
        const forward=way.nodes.some((n,j)=>n===a&&way.nodes[j+1]===b);
        const backward=way.nodes.some((n,j)=>n===b&&way.nodes[j+1]===a);
        assert.ok(forward||backward);if(edge.directed)assert.ok(way.tags.oneway==='-1'?backward:forward);
      }
    }
    assert.ok(edge.lengthMeters>0&&Number.isInteger(edge.minutes)&&edge.minutes>0);
    assert.equal(edge.minutes,Math.max(1,Math.ceil(edge.lengthMeters/250)));
    assert.match(edge.timeAssumption,/演练/);
    assert.match(edge.statusAssumption,/不是当前可通行证明/);
  }
});

test('every retained geographic junction is reachable in both directions and business IDs are preserved',()=>{
  const d=create(),s=d.scenario;
  for(const node of s.nodes){
    assert.ok(E.shortestPath(s,'D',node.id),'D → '+node.id);
    assert.ok(E.shortestPath(s,node.id,'D'),node.id+' → D');
    assert.ok(Number.isFinite(node.x)&&Number.isFinite(node.y));
    assert.ok(node.longitude>=network.region.bounds[0]&&node.longitude<=network.region.bounds[2]);
    assert.ok(node.latitude>=network.region.bounds[1]&&node.latitude<=network.region.bounds[3]);
  }
  for(const id of ['D','H1','H2','H3','H4','H5','H6','S1','S2'])assert.ok(s.nodes.some(n=>n.id===id));
  for(const village of d.villages)for(const pickup of village.pickups){
    const node=s.nodes.find(n=>n.id===pickup.node);
    assert.equal(pickup.longitude,node.longitude);assert.equal(pickup.latitude,node.latitude);
    assert.equal(pickup.synthetic,true);assert.match(pickup.coordinateSource,/用途为演练/);
  }
});

test('shortest path respects one-way direction and does not invent reverse travel',()=>{
  const graph={nodes:[{id:'A'},{id:'B'},{id:'C'}],edges:[{id:'one',from:'A',to:'B',minutes:1,open:true,directed:true},{id:'two',from:'B',to:'C',minutes:1,open:true}]};
  assert.deepEqual(E.shortestPath(graph,'A','C').edges,['one','two']);
  assert.deepEqual(E.shortestPath(graph,'C','B').edges,['two']);
  assert.equal(E.shortestPath(graph,'B','A'),null);
  graph.edges[0].open=false;assert.equal(E.shortestPath(graph,'A','C'),null);
});

test('road exercise plans use continuous source geometry, obey directions and replan around closures',()=>{
  const d=create(),input=X.snapshot(d),first=X.solve(input).plan;
  assert.equal(first.servedPeople,15);assert.deepEqual(X.validate(input,first),[]);
  const used=new Set();
  for(const route of first.routes)for(const segment of route.segments){
    for(let i=0;i<segment.edges.length;i++){
      const edge=d.scenario.edges.find(e=>e.id===segment.edges[i]);used.add(edge.id);
      assert.ok((edge.from===segment.nodes[i]&&edge.to===segment.nodes[i+1])||(!edge.directed&&edge.to===segment.nodes[i]&&edge.from===segment.nodes[i+1]));
      const geometry=edge.from===segment.nodes[i]?edge.geometry:[...edge.geometry].reverse();
      const from=d.scenario.nodes.find(n=>n.id===segment.nodes[i]),to=d.scenario.nodes.find(n=>n.id===segment.nodes[i+1]);
      assert.deepEqual(geometry[0],[from.longitude,from.latitude]);assert.deepEqual(geometry.at(-1),[to.longitude,to.latitude]);
    }
  }
  const blocked=[...used][0];d.scenario.edges.find(e=>e.id===blocked).open=false;d.inputVersion++;
  const nextInput=X.snapshot(d),next=X.solve(nextInput).plan;
  assert.deepEqual(X.validate(nextInput,next),[]);
  assert.ok(next.routes.every(r=>r.segments.every(seg=>!seg.edges.includes(blocked))));
  assert.equal(next.servedPeople+next.unassigned.reduce((n,h)=>n+h.people,0),15);
});

test('geographic configuration cannot silently overwrite recorded exercise work',()=>{
  const d=X.initial();d.contacts.H1.contacted=true;
  assert.throws(()=>G.apply(d),/新建演练/);
  const executing=X.initial();executing.phase='executing';
  assert.throws(()=>G.apply(executing),/新建演练/);
  const reported=X.initial();reported.reports.push({id:'R1'});
  assert.throws(()=>G.apply(reported),/新建演练/);
});
