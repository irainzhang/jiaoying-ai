"""Build the Ruian place picker from the checked-in OSM snapshot.

No network, no geocoding API, and no inferred administrative affiliations.
Coordinates of route candidates are exact retained OSM road nodes. Government
community names are a manually reviewed, cited subset without invented points.
"""
import collections
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'dist/assets/maps'
WATER_PLAN = 'https://www.ruian.gov.cn/module/download/downfile.jsp?classid=0&filename=6b54135a13814c949ba973b51c85b2df.pdf'
WEATHER_PLAN = 'https://www.ruian.gov.cn/art/2021/3/8/art_1229181511_3854837.html'
# Only names explicitly listed under these streets in the public planning table.
# This is a searchable name subset, not a complete/current administrative roll.
COMMUNITIES = {
    '玉海街道': ['东镇社区', '宾阳门社区', '永胜门社区', '水心社区', '忠义街社区', '殿巷社区'],
    '安阳街道': ['育才社区', '康佳社区', '广场社区', '风荷社区', '华瑞社区', '进源社区', '兴隆社区', '祥云社区', '万松社区', '隆山社区', '之江社区'],
    '锦湖街道': ['河埭桥社区', '瑞湖社区', '集云社区'],
}
STREET_ORDER = ['玉海街道', '安阳街道', '锦湖街道', '东山街道', '上望街道', '莘塍街道', '汀田街道', '飞云街道']


def meters(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, [*a, *b])
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 12742017.6 * math.asin(min(1, math.sqrt(h)))


def build():
    names = ['ruian-osm-raw.json', 'ruian-urban.geojson', 'ruian-routing.json']
    file_bytes = {name: (ASSETS/name).read_bytes() for name in names}
    raw, urban, routing = [json.loads(file_bytes[name]) for name in names]
    node_by_osm = {n['osmNodeId']: n for n in routing['nodes']}
    usable = {i: n for i, n in node_by_osm.items() if not n.get('businessUse')}
    ways_at = collections.defaultdict(list)
    for way in raw['elements']:
        tags = way.get('tags', {})
        if way['type'] != 'way' or not tags.get('highway') or not (tags.get('name:zh') or tags.get('name')):
            continue
        for node_id in way.get('nodes', []):
            if node_id in usable:
                ways_at[node_id].append(way)

    def road_name(way):
        return way['tags'].get('name:zh') or way['tags']['name']

    def coord(osm_id):
        n = usable[osm_id]
        return [n['longitude'], n['latitude']]

    picks = []
    selected = set()

    def pickup(osm_id, name, kind, roads):
        n = usable[osm_id]
        evidence_ways = [w for w in ways_at[osm_id] if road_name(w) in roads]
        assert set(roads) <= {road_name(w) for w in evidence_ways}
        assert all(osm_id in w['nodes'] for w in evidence_ways)
        selected.add(osm_id)
        return {
            'id': 'RA-ROAD-' + str(osm_id), 'name': name, 'kind': kind,
            'nodeId': n['id'], 'osmNodeId': osm_id,
            'longitude': n['longitude'], 'latitude': n['latitude'], 'coordinateSystem': 'WGS84',
            'sourceName': 'OpenStreetMap 道路快照', 'sourceUrl': n['sourceUrl'],
            'sourceUrls': [n['sourceUrl']] + sorted({'https://www.openstreetmap.org/way/'+str(w['id']) for w in evidence_ways}),
            'roadNames': roads, 'administrativeAreaId': None, 'administrativeAffiliation': 'unverified',
            'routable': True, 'officialAssemblyPoint': False,
            'description': '真实道路位置；接人用途为演练选择，非已核定集合点。街道辖属待核。',
        }

    # Named junctions require an identical OSM node shared by named ways.
    # Closely spaced carriageway nodes for the same crossing are represented once.
    junctions = [(i, sorted({road_name(w) for w in ws})) for i, ws in ways_at.items()
                 if len({road_name(w) for w in ws}) >= 2]
    for osm_id, roads in sorted(junctions, key=lambda p: (-len(p[1]), p[0])):
        if any(meters(coord(osm_id), [p['longitude'], p['latitude']]) < 100
               and set(roads) & set(p['roadNames']) for p in picks):
            continue
        picks.append(pickup(osm_id, ' / '.join(roads) + '交叉口', 'road-junction', roads))

    # Additional exact road-node references widen the usable selection without
    # claiming that a road centroid is a village office, park gate, or shelter.
    on_road = collections.defaultdict(set)
    for osm_id, ways in ways_at.items():
        for way in ways:
            on_road[road_name(way)].add(osm_id)
    for road, road_nodes in sorted(on_road.items()):
        if len(road_nodes) < 2:
            continue
        points = [coord(i) for i in road_nodes]
        dx = (max(p[0] for p in points)-min(p[0] for p in points))*math.cos(math.radians(27.78))
        dy = max(p[1] for p in points)-min(p[1] for p in points)
        axis = 0 if dx >= dy else 1
        ordered = sorted(road_nodes, key=lambda i: (coord(i)[axis], i))
        candidates = [(ordered[0], '西侧' if axis == 0 else '南侧'),
                      (ordered[-1], '东侧' if axis == 0 else '北侧')]
        for osm_id, side in candidates:
            if osm_id in selected:
                continue
            if any(meters(coord(osm_id), [p['longitude'], p['latitude']]) < 100 for p in picks):
                continue
            picks.append(pickup(osm_id, road + '（片区' + side + '道路点）', 'road-point', [road]))
    picks.sort(key=lambda p: (p['kind'] != 'road-junction', p['name'], p['osmNodeId']))

    districts = []
    places = {f['properties'].get('name'): f for f in urban['features'] if f['properties'].get('kind') == 'place'}
    for street in STREET_ORDER:
        feature = places[street]
        props = feature['properties']
        districts.append({
            'id': 'RA-AREA-'+str(props['osm_id']), 'name': street, 'kind': 'subdistrict', 'township': street,
            'sourceName': 'OpenStreetMap 地名快照 / 瑞安市政府公开规划', 'sourceUrl': props['source_url'],
            'sourceUrls': [props['source_url'], WEATHER_PLAN],
            'center': feature['geometry']['coordinates'], 'centerUse': '地图地名标注点，非行政边界或接人点',
            'pickups': [],
        })
    for street, communities in COMMUNITIES.items():
        parent = next(d for d in districts if d['name'] == street)
        for index, community in enumerate(communities, 1):
            districts.append({
                'id': parent['id']+'-C'+str(index), 'name': community, 'kind': 'community',
                'township': street, 'parentId': parent['id'], 'sourceName': '瑞安市水域保护规划报告 · 公开文件中的部分社区名称',
                'sourceUrl': WATER_PLAN, 'sourcePage': 106, 'pickups': [],
                'locationStatus': '未取得经核实的社区接人点坐标',
            })
    districts.append({
        'id': 'RA-URBAN-ROADS', 'name': '瑞安市城区道路', 'kind': 'road-group',
        'sourceName': 'OpenStreetMap 道路快照', 'sourceUrl': 'https://www.openstreetmap.org/copyright',
        'description': '按当前道路演练片区组织的公共候选组，不是行政区划。', 'pickups': picks,
    })
    landmarks = []
    for feature in urban['features']:
        props = feature['properties']
        if props.get('kind') == 'park' and props.get('name'):
            # Geometry retained for map context, never fabricated pickup coordinates.
            landmarks.append({'id': feature['id'], 'name': props['name'], 'kind': 'park-reference',
                              'sourceUrl': props['source_url'], 'geometry': feature['geometry'],
                              'routable': False, 'officialAssemblyPoint': False,
                              'description': '地图地标参考；未核实可停车入口，不能直接当作接人点。'})

    result = {
        'version': 'ruian-places-v1', 'schema': 'jiaoying-place-directory-v1',
        'generatedOn': '2026-10-05', 'coordinateSystem': 'WGS84',
        'coverage': {'name': '瑞安城区与周边已收录地名', 'mapBounds': urban['metadata']['selection_bbox'],
                     'routingBounds': routing['region']['bounds'],
                     'scope': '8 个街道和公开文件所列部分城区社区；不是瑞安市全量村社目录。',
                     'administrativeBoundariesAvailable': False},
        'sources': [
            {'name': 'OpenStreetMap contributors', 'url': 'https://www.openstreetmap.org/copyright',
             'snapshotTime': raw['osm3s']['timestamp_osm_base'], 'license': 'ODbL 1.0',
             'licenseUrl': 'https://opendatacommons.org/licenses/odbl/1-0/'},
            {'name': '瑞安市水域保护规划报告', 'url': WATER_PLAN,
             'mirrorUrl': 'https://zjjcmspublic.oss-cn-hangzhou-zwynet-d01-a.internet.cloud.zj.gov.cn/jcms_files/jcms1/web2631/site/attach/0/6b54135a13814c949ba973b51c85b2df.pdf',
             'page': 106, 'use': '核对部分社区名称及上级街道；不提供接人点坐标或保证当前行政隶属。'},
            {'name': '瑞安市气象探测环境保护专项规划（修编）公示', 'url': WEATHER_PLAN,
             'publishedOn': '2021-03-08', 'use': '辅助核对街道名称，不用于天气或通行数据。'},
        ],
        'provenance': {'builder': 'scripts/build-place-directory.py',
                       'inputSha256': {name: hashlib.sha256(data).hexdigest() for name, data in file_bytes.items()}},
        'notes': [
            '真实道路节点与地名来自公开资料；人员、车辆、容量及道路可通行状态仍是演练设定。',
            '不按最近街道标注点猜测行政归属；道路候选作为全片区公共列表，辖属待核。',
            '社区只有公开文件名称；没有坐标时不伪造村委会位置，不自动分配接人点。',
            '片区东/西/南/北侧道路点是目录内的相对方位描述，不是官方地名或道路全长端点。',
            '公园保留面状地理参考，不以面中心冒充车辆入口或安全集合点。',
        ],
        'districts': districts, 'sharedPickups': picks, 'landmarks': landmarks,
    }
    assert len({d['id'] for d in districts}) == len(districts)
    assert len({p['id'] for p in picks}) == len(picks)
    assert len(picks) >= 8
    (ASSETS/'ruian-places.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'districts': len(districts), 'subdistricts': len(STREET_ORDER),
                      'communities': sum(map(len, COMMUNITIES.values())),
                      'roadCandidates': len(picks), 'landmarks': len(landmarks)}, ensure_ascii=False))


if __name__ == '__main__':
    build()
