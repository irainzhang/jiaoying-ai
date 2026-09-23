[out:json][timeout:50];
(
 way[highway](27.74,120.60,27.82,120.70);
 way[waterway](27.74,120.60,27.82,120.70);
 way[natural=water](27.74,120.60,27.82,120.70);
 relation[natural=water](27.74,120.60,27.82,120.70);
 way[landuse~"forest|grass|recreation_ground"](27.74,120.60,27.82,120.70);
 way[leisure=park](27.74,120.60,27.82,120.70);
 node[place](27.74,120.60,27.82,120.70);
);
out geom;