const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const maps = path.join(__dirname, '../dist/assets/maps');
const read = name => JSON.parse(fs.readFileSync(path.join(maps, name), 'utf8'));
const directory = read('ruian-places.json');
const routing = read('ruian-routing.json');
const raw = read('ruian-osm-raw.json');
const urban = read('ruian-urban.geojson');

test('Ruian directory records exact source snapshots and bounded coverage', () => {
  for (const [name, expected] of Object.entries(directory.provenance.inputSha256)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(maps, name))).digest('hex'), expected);
  }
  assert.deepEqual(directory.coverage.routingBounds, routing.region.bounds);
  assert.equal(directory.coverage.administrativeBoundariesAvailable, false);
  assert.match(directory.coverage.scope, /不是.*全量/);
});

test('real streets match original OSM named place points; synthetic villages are absent', () => {
  const streets = directory.districts.filter(d => d.kind === 'subdistrict');
  assert.equal(streets.length, 8);
  for (const street of streets) {
    const original = urban.features.find(f => f.properties.name === street.name && f.properties.kind === 'place');
    assert.ok(original);
    assert.deepEqual(street.center, original.geometry.coordinates);
    assert.equal(street.sourceUrl, original.properties.source_url);
    assert.deepEqual(street.pickups, []);
  }
  assert.equal(directory.districts.some(d => /演示村/.test(d.name)), false);
});

test('all public road candidates use exact non-synthetic route nodes', () => {
  assert.ok(directory.sharedPickups.length >= 8);
  const ids = new Set();
  for (const pickup of directory.sharedPickups) {
    const node = routing.nodes.find(n => n.id === pickup.nodeId);
    assert.ok(node);
    assert.equal(node.businessUse, null);
    assert.equal(node.osmNodeId, pickup.osmNodeId);
    assert.equal(node.longitude, pickup.longitude);
    assert.equal(node.latitude, pickup.latitude);
    assert.equal(pickup.coordinateSystem, 'WGS84');
    assert.equal(pickup.routable, true);
    assert.equal(pickup.officialAssemblyPoint, false);
    assert.equal(ids.has(pickup.id), false);
    ids.add(pickup.id);
  }
});

test('junction names are backed by named OSM ways sharing the actual route node', () => {
  const junctions = directory.sharedPickups.filter(p => p.kind === 'road-junction');
  assert.equal(junctions.length, 3);
  for (const pickup of directory.sharedPickups) {
    const ways = raw.elements.filter(w => w.type === 'way' && w.tags?.highway && w.nodes?.includes(pickup.osmNodeId));
    const names = new Set(ways.map(w => w.tags['name:zh'] || w.tags.name));
    for (const name of pickup.roadNames) assert.ok(names.has(name), `${pickup.id}: ${name}`);
    assert.ok(pickup.sourceUrls.includes(`https://www.openstreetmap.org/node/${pickup.osmNodeId}`));
    assert.ok(pickup.sourceUrls.some(url => url.includes('/way/')));
    if (pickup.kind === 'road-junction') assert.ok(pickup.roadNames.length >= 2);
  }
});

test('no nearest-centre administrative membership or fabricated community coordinates', () => {
  for (const pickup of directory.sharedPickups) {
    assert.equal(pickup.administrativeAreaId, null);
    assert.equal(pickup.administrativeAffiliation, 'unverified');
  }
  const communities = directory.districts.filter(d => d.kind === 'community');
  assert.equal(communities.length, 20);
  for (const community of communities) {
    const parent = directory.districts.find(d => d.id === community.parentId);
    assert.equal(parent.kind, 'subdistrict');
    assert.equal(parent.name, community.township);
    assert.equal(community.longitude, undefined);
    assert.equal(community.latitude, undefined);
    assert.equal(community.center, undefined);
    assert.deepEqual(community.pickups, []);
    assert.match(community.sourceUrl, /^https:\/\/www\.ruian\.gov\.cn\//);
  }
});

test('park references preserve source geometry and are never fabricated pickup gates', () => {
  assert.equal(directory.landmarks.length, 4);
  for (const landmark of directory.landmarks) {
    const original = urban.features.find(f => f.id === landmark.id);
    assert.equal(landmark.name, original.properties.name);
    assert.deepEqual(landmark.geometry, original.geometry);
    assert.equal(landmark.routable, false);
    assert.equal(landmark.officialAssemblyPoint, false);
    assert.equal(directory.sharedPickups.some(p => p.id === landmark.id), false);
  }
});
