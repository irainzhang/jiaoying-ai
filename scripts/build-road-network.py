"""Build a reproducible, limited exercise road graph from the bundled OSM snapshot.

No network request. Connections require identical OSM node IDs. Retain geometry,
one-way direction and provenance; synthetic durations are NOT traffic estimates.
"""
import collections
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'dist/assets/maps'
BBOX = [120.633, 27.777, 120.652, 27.791]
ALLOWED = {'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary',
           'tertiary_link', 'unclassified', 'residential', 'service', 'living_street'}
TARGETS = {
    'D': (120.636, 27.783), 'H1': (120.635, 27.788),
    'H2': (120.640, 27.787), 'H3': (120.646, 27.788),
    'H4': (120.649, 27.784), 'H5': (120.646, 27.779),
    'H6': (120.636, 27.779), 'S1': (120.640, 27.779),
    'S2': (120.650, 27.787),
}


def meters(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, [*a, *b])
    hav = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371008.8 * 2 * math.asin(min(1, math.sqrt(hav)))


def reachable(adj, start):
    found, pending = {start}, [start]
    while pending:
        for nxt in adj[pending.pop()]:
            if nxt not in found:
                found.add(nxt)
                pending.append(nxt)
    return found


def build():
    raw_bytes = (ASSETS / 'ruian-osm-raw.json').read_bytes()
    raw = json.loads(raw_bytes)
    source = json.loads((ASSETS / 'source-metadata.json').read_text(encoding='utf-8'))
    coords, segments = {}, []
    excluded = collections.Counter()
    for way in raw['elements']:
        tags = way.get('tags', {})
        if way['type'] != 'way' or tags.get('highway') not in ALLOWED:
            continue
        # Missing restrictions are an explicitly disclosed snapshot limitation.
        if any(tags.get(key) in {'no', 'private'} for key in ('access', 'vehicle', 'motor_vehicle', 'motorcar')):
            excluded['explicit_access_restriction'] += 1
            continue
        if tags.get('access:conditional') or tags.get('motor_vehicle:conditional'):
            excluded['conditional_access_not_evaluated'] += 1
            continue
        direction = tags.get('oneway', 'yes' if tags.get('junction') == 'roundabout' else 'no')
        if direction not in {'yes', 'true', '1', '-1', 'no', 'false', '0'}:
            excluded['unsupported_direction'] += 1
            continue
        points = list(zip(way.get('nodes', []), way.get('geometry', [])))
        for idx, ((a, pa), (b, pb)) in enumerate(zip(points, points[1:])):
            if a == b or not all(BBOX[0] <= p['lon'] <= BBOX[2] and BBOX[1] <= p['lat'] <= BBOX[3] for p in (pa, pb)):
                continue
            ca, cb = [pa['lon'], pa['lat']], [pb['lon'], pb['lat']]
            if meters(ca, cb) < .01:
                continue
            coords[a], coords[b] = ca, cb
            if direction == '-1':
                a, b, ca, cb = b, a, cb, ca
            segments.append({'a': a, 'b': b, 'geometry': [ca, cb], 'way': way['id'],
                             'part': idx, 'name': tags.get('name:zh') or tags.get('name', '未命名道路'),
                             'highway': tags['highway'], 'directed': direction in {'yes', 'true', '1', '-1'},
                             'directionTag': direction})
    adj, reverse = collections.defaultdict(set), collections.defaultdict(set)
    for edge in segments:
        a, b = edge['a'], edge['b']
        adj[a].add(b); reverse[b].add(a)
        if not edge['directed']:
            adj[b].add(a); reverse[a].add(b)
    # Largest strongly connected component: every retained point can return.
    pending, components = set(coords), []
    while pending:
        start = min(pending)
        component = reachable(adj, start) & reachable(reverse, start)
        components.append(component)
        pending -= component
    keep = max(components, key=lambda c: (len(c), -min(c)))
    segments = [e for e in segments if e['a'] in keep and e['b'] in keep]
    alias, chosen = {}, set()
    for name, target in TARGETS.items():
        point = min(keep-chosen, key=lambda n: (meters(coords[n], target), n))
        chosen.add(point); alias[point] = name
    incident = collections.defaultdict(list)
    for i, edge in enumerate(segments):
        incident[edge['a']].append(i); incident[edge['b']].append(i)
    # Compress only within one OSM way, never across a junction or business point.
    important = set(chosen)
    for node, ids in incident.items():
        if len(ids) != 2:
            important.add(node); continue
        first, second = [segments[i] for i in ids]
        same_way = first['way'] == second['way'] and first['directed'] == second['directed']
        forward = not first['directed'] or (first['b'] == second['a'] or second['b'] == first['a'])
        if not same_way or not forward:
            important.add(node)
    used, edges = set(), []
    for start in sorted(important):
        for first_index in sorted(incident[start]):
            if first_index in used:
                continue
            current, index, geometry, chain, geometry_ids = start, first_index, [coords[start]], [], [start]
            while True:
                segment = segments[index]
                used.add(index); chain.append(segment)
                nxt = segment['b'] if segment['a'] == current else segment['a']
                geometry.append(coords[nxt])
                geometry_ids.append(nxt)
                if nxt in important:
                    break
                current = nxt
                index = next(i for i in incident[current] if i not in used)
            a, b = start, nxt
            if chain[0]['directed'] and chain[0]['a'] != start:
                a, b, geometry = b, a, list(reversed(geometry))
                geometry_ids.reverse()
            if a == b:
                continue
            length = sum(meters(x, y) for x, y in zip(geometry, geometry[1:]))
            # Integer minutes avoid floating-point drift in existing exact audits.
            # 15 km/h and ceiling per compressed edge are declared exercise inputs.
            edges.append({'id': 'osm-'+str(chain[0]['way'])+'-'+str(min(e['part'] for e in chain)),
                          'from': alias.get(a, 'O'+str(a)), 'to': alias.get(b, 'O'+str(b)),
                          'label': chain[0]['name'], 'highway': chain[0]['highway'],
                          'directed': chain[0]['directed'], 'directionTag': chain[0]['directionTag'],
                          'open': True, 'minutes': max(1, math.ceil(length/250)),
                          'lengthMeters': round(length, 2), 'geometry': geometry,
                          'osmWayIds': sorted({e['way'] for e in chain}),
                          'osmNodeIds': geometry_ids,
                          'source': 'OpenStreetMap', 'sourceUrl': 'https://www.openstreetmap.org/way/'+str(chain[0]['way']),
                          'timeAssumption': '演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间',
                          'statusAssumption': '初始开放为演练设定；不是当前可通行证明'})
    active_ids = {e[k] for e in edges for k in ('from', 'to')}
    labels = {'D': '演练车辆集结点', 'S1': '演练接收点 A', 'S2': '演练接收点 B'}
    nodes = []
    for osm_id in sorted(important):
        identifier = alias.get(osm_id, 'O'+str(osm_id))
        if identifier not in active_ids:
            continue
        lon, lat = coords[osm_id]
        kind = 'depot' if identifier == 'D' else 'shelter' if identifier.startswith('S') else 'home' if identifier.startswith('H') else 'junction'
        nodes.append({'id': identifier, 'longitude': lon, 'latitude': lat, 'osmNodeId': osm_id,
                      'x': round(70+(lon-BBOX[0])/(BBOX[2]-BBOX[0])*660, 2),
                      'y': round(50+(BBOX[3]-lat)/(BBOX[3]-BBOX[1])*420, 2),
                      'kind': kind, 'label': labels.get(identifier, ('演练集合点 '+identifier[1:]) if kind == 'home' else '道路节点 '+str(osm_id)),
                      'businessUse': 'synthetic' if kind != 'junction' else None,
                      'sourceUrl': 'https://www.openstreetmap.org/node/'+str(osm_id)})
    result = {'schema': 'jiaoying-osm-roads-v1', 'region': {'name': '浙江省瑞安市 · 城区道路演练片区',
        'mapKind': 'osm-road-network', 'coordinateSystem': 'WGS84', 'bounds': BBOX,
        'longitude': (BBOX[0]+BBOX[2])/2, 'latitude': (BBOX[1]+BBOX[3])/2},
        'metadata': {'source': 'OpenStreetMap contributors', 'sourceTime': source['sourceTime'],
                     'license': 'ODbL 1.0', 'sourceUrl': source['attribution_url'],
                     'licenseUrl': source['license_url'], 'originalFile': 'ruian-osm-raw.json',
                     'originalSha256': hashlib.sha256(raw_bytes).hexdigest(),
                     'builder': 'scripts/build-road-network.py', 'algorithm': 'shared OSM IDs + largest SCC + same-way degree-2 compression v1',
                     'rawConnectedNodes': len(keep), 'nodeCount': len(nodes), 'edgeCount': len(edges),
                     'onewayEdges': sum(e['directed'] for e in edges), 'excluded': dict(excluded),
                     'assumptions': ['真实道路几何与单行标签来自公开历史快照；业务用途、人员、车辆、容量和通行时间均为演练设定。',
                         '演练集合点与接收点绑定道路节点，不表示真实村委会、建筑入口或官方避难场所。',
                         '只在共享 OSM 节点连接，不以几何交叉推断路口；仅保留可双向互达的有限片区。',
                         '保留单行方向，排除明示禁止机动车/私人道路；未收录完整转向限制、车型限高、实时路况与临时交通管制。',
                         '每路段 15 km/h 并向上取整分钟是可复现演练参数，不用于安全导航。',
                         'OSM 来源与许可不等于比赛已审核地图来源，参赛资格仍待团队核实。']},
        'nodes': nodes, 'edges': sorted(edges, key=lambda e: e['id'])}
    assert len({e['id'] for e in edges}) == len(edges)
    assert set(TARGETS) <= {n['id'] for n in nodes}
    (ASSETS / 'ruian-routing.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k: result['metadata'][k] for k in ('rawConnectedNodes', 'nodeCount', 'edgeCount', 'onewayEdges')}))


if __name__ == '__main__':
    build()
