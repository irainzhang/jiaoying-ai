# 瑞安市城区真实地理底图来源记录

## 可直接接入

- `ruian-urban.geojson`：标准 GeoJSON FeatureCollection，WGS84，经度在前、纬度在后。包含 1,461 个真实 OSM 要素：道路 1,198，水系 247，公园/绿地 6，地名 10。只用于地理底图。
- `ruian-osm-raw.json`：未修改的 Overpass JSON 原始响应。
- `query.overpassql`：完整原始查询，可复查选取类型和范围。
- `source-metadata.json`：来源、查询范围、中心、版本时间及许可。

查询范围为 [120.60, 27.74, 120.70, 27.82]，依次为西、南、东、北。这是瑞安市城区及飞云江局部展示范围，不是瑞安市行政边界，也不覆盖全市。

OSM 瑞安市地名节点（node/244081677）坐标为经度 120.6511821、纬度 27.7809878，可用作初始中心。Leaflet 接受纬度在前，调用时需交换顺序。建议默认视图 fitBounds([[27.74,120.60],[27.82,120.70]])，设置合适 maxBounds，不要绘制此矩形为行政边界。

## 字段

每个 Feature 具有标准 id=`way/123` 或 `node/123`。properties 中保留原始 OSM 标签，另加：

- kind：road / water / park / place。
- name：原始名称或空字符串。
- osmId：与 Feature id 相同。
- source：OpenStreetMap。
- source_url：对应 www.openstreetmap.org/way、node 或 relation 页面。
- osm_type、osm_id：原始类型和数值编号。

water 要素可能为 LineString（水系中心线）或 Polygon（水域面），应按 geometry.type 分层渲染。飞云江水域来自 relation/11889461，两条 outer 成员首尾相接组成闭合 Polygon。飞云江中心线来自 way/55149756。park 类包含原始 landuse/leisure/natural 标记，不能全部称作正式公园。

元数据 metadata：bounds/selection_bbox、center、coordinate_system、source、endpoint、fetched_at、sourceTime/osm_timestamp、license、license_url、attribution、attribution_url、feature_count、kind_counts。

## 来源与时效

通过 https://overpass-api.de/api/interpreter 一次 POST 查询取得，未下载任何地图瓦片。

- OSM 数据基准时间：2026-09-22T08:45:51Z。
- 本次获取时间：2026-09-22T12:50:33.483761+00:00。
- GeoJSON 仅将原始坐标转换为标准几何，并拼合所含闭合水域关系；没有添加人为道路或伪造河岸，没有平滑坐标。
- 选取 API 会返回落入范围的完整 way/relation，因此部分相连要素延伸到范围外。保留它们可以正确显示河流和道路，渲染视口应限制在目标片区。
- 地名、道路、河岸为 OSM 社区地理数据，不能由此认定道路当前可通行、存在某个官方避难所、某地存在洪水，不能视为经过验证的应急导航网络。
- 当前没有实时道路状态、积水深度、交通限行、车速或天气数据。演练家庭、车辆、避难点等业务图层仍须标为演练数据。
- 如果继续使用原合成调度图，其路线不能叠加为实际道路导航路线；应在独立“调度示意”视图展示，或明确地理底图和合成拓扑为两个视图。

## 可核对地理要素

| 名称 | OSM 来源 | 某个真实几何顶点（经度, 纬度） |
|---|---|---|
| 瑞安市 | https://www.openstreetmap.org/node/244081677 | 120.6511821, 27.7809878 |
| 安阳街道 | https://www.openstreetmap.org/node/5144881171 | 120.6359124, 27.7803920 |
| 玉海街道 | https://www.openstreetmap.org/node/8402085478 | 120.6338471, 27.7853326 |
| 飞云街道 | https://www.openstreetmap.org/node/8402085427 | 120.6159782, 27.7643109 |
| 飞云江大桥 | https://www.openstreetmap.org/way/207218666 | 120.6192700, 27.7647008 |
| 万松东路 | https://www.openstreetmap.org/way/338689473 | 120.6576877, 27.7807501 |
| 罗阳大道 | https://www.openstreetmap.org/way/339006401 | 120.6562515, 27.7732681 |
| 瑞祥大道 | https://www.openstreetmap.org/way/549400214 | 120.6382666, 27.7743516 |

表内道路坐标只是该 way 的一个顶点，不是门牌、设施或官方中心点。

## 许可与展示

地图上持续可见显示“© OpenStreetMap contributors”，链接 https://www.openstreetmap.org/copyright 。数据许可 ODbL 1.0：https://opendatacommons.org/licenses/odbl/1-0/ 。本提取数据库及其改编继续受 ODbL 约束；发布数据时保留原始来源、许可链接以及适用的署名、同许可分享义务。本说明不是对独立应用程序代码变更许可的要求。

原始来源：
- OSM 版权及许可：https://www.openstreetmap.org/copyright
- OSM Overpass 文档：https://wiki.openstreetmap.org/wiki/Overpass_API
- Overpass 官方资源使用说明：https://dev.overpass-api.de/overpass-doc/en/preface/commons.html

当前方案是保存一次合理范围的公开矢量查询并本地绘制，无需运行时访问 Overpass，不把公共 API 用作持续业务后端。

如另行增加可选在线 OSM 瓦片，必须遵守 https://operations.osmfoundation.org/policies/tiles/ ：只正常交互加载用户正在查看的视口，使用 https://tile.openstreetmap.org/{z}/{x}/{y}.png ，保留可见署名和真实浏览器 Referer，遵守缓存头；不得批量预取、下载离线瓦片、绕过缓存、伪装客户端、屏蔽 Referer。公共瓦片服务没有 SLA。因此本地 V3 默认推荐本文件的本地矢量渲染。
