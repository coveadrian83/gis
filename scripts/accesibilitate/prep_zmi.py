"""Prepare ZMI layers for Madina from the World Bank / MPM Iași database (all EPSG:3844).
# Notă: Madina (github.com/City-Form-Lab/madina) se instalează din sursă; cu pandas 3 sunt necesare două corecturi:
# eliminarea argumentului fastpath= din pd.Series(...) și, în zonal/network.py, add_node(...) în loc de nodes[...]['type'] = ...
# pentru nodurile izolate. Căile /mnt/... și /home/claude/... sunt cele din mediul de calcul folosit la rulare.
Outputs in data/: network.geojson, pop.geojson, stops_<set>.geojson
"""
import geopandas as gpd, pandas as pd, numpy as np
from shapely.geometry import box
from shapely.ops import unary_union
from shapely import line_merge

W = "/mnt/user-data/uploads/_World_Bank_/"
G = W + "Baza_de_date/WB_Iasi_2025_GDB/"

# ---- population (WorldPop 2020, 100 m points) -> study area = grid extent
pop = gpd.read_file(W + "shp/populatie_ZMI_grid.shp")
pop = pop[pop.pop2020 >= 0.5][["pop2020", "geometry"]].reset_index(drop=True)
area = box(*pop.total_bounds).buffer(1500)
pop.to_file("data/pop.geojson", driver="GeoJSON")
print("pop points", len(pop), "pop", round(pop.pop2020.sum()))

# ---- walk network (Geofabrik OSM roads), noded at every crossing
r = gpd.read_file(G + "OpenStreetMap.gpkg", layer="gis_osm_roads", mask=area)
r = r[~r.fclass.isin(["motorway", "motorway_link", "trunk", "trunk_link"])]
r = r.explode(index_parts=False)
# Geofabrik ways are not split at intersections: node them. Bridges/tunnels (layer != 0) are noded separately
# so an overpass does not create a false junction with the street below.
parts = []
for lyr, grp in r.groupby(r["layer"].fillna(0).astype(int).clip(-1, 1)):
    u = unary_union(grp.geometry.values)
    parts.extend(list(getattr(u, "geoms", [u])))
net = gpd.GeoDataFrame(geometry=parts, crs=3844)
net = net[net.geometry.geom_type == "LineString"]
net = net[net.length > 0.05].reset_index(drop=True)
net.to_file("data/network.geojson", driver="GeoJSON")
print("network segments", len(net), "km", round(net.length.sum() / 1000))

# ---- lines serving each stop: OSM route relations (urban bus + tram) + MPM metropolitan routes
urb = gpd.read_file(W + "shp/trasee_TP_ZMI.shp")
urb = urb[urb["route"].isin(["bus", "tram", "trolleybus"])][["ref", "route", "geometry"]]
urb["line"] = urb["route"].str[0] + ":" + urb["ref"].astype(str)
met = gpd.read_file(W + "shp/concept/trasee_TP_ZM_Iasi.shp")[["folders", "geometry"]]
met["line"] = "m:" + met["folders"].str.split("; ").str[-1].str.extract(r"(\d{3})")[0].fillna("?")
lines = pd.concat([urb[["line", "geometry"]], met[["line", "geometry"]]], ignore_index=True)
lines = gpd.GeoDataFrame(lines, crs=3844)

def n_lines(stops, tol=35):
    j = gpd.sjoin(stops[["geometry"]].assign(_i=range(len(stops))), lines.assign(geometry=lines.buffer(tol)), predicate="within")
    return j.groupby("_i")["line"].nunique().reindex(range(len(stops)), fill_value=0).values

# ---- stops
tram = gpd.read_file(W + "shp/statii_tramvai_uat_Iasi.shp")[["name", "geometry"]].assign(mode="tramvai")
bus = gpd.read_file(W + "shp/statii_autobuz_uat_Iasi.shp")[["name", "geometry"]].assign(mode="autobuz urban")
mb = gpd.read_file(W + "shp/transport_public/statii_autobuz_metropolitan_dissolved.shp")[["name", "geometry"]]
mb = mb.explode(index_parts=False).assign(mode="autobuz metropolitan")
cf = gpd.read_file(G + "Infrastructura_Mobilitate.gpkg", layer="Feroviar_Statii")[["name", "geometry"]]
cf = cf[cf.within(area) & ~cf.name.str.contains("Remiza")].assign(mode="tren (stație CF)")
tm = gpd.read_file(G + "Infrastructura_Mobilitate.gpkg", layer="Tren_Metropolitan_Statii")[["Name", "geometry"]]
tm = tm.rename(columns={"Name": "name"}).assign(mode="tren metropolitan propus")

allst = pd.concat([tram, bus, mb, cf], ignore_index=True)
allst = gpd.GeoDataFrame(allst, crs=3844)
allst = allst[allst.within(area)].reset_index(drop=True)
allst["lines"] = n_lines(allst)
# drop exact duplicates (same stop present in urban and metropolitan layers, < 5 m apart)
allst["k"] = (allst.geometry.x // 5).astype(int).astype(str) + "_" + (allst.geometry.y // 5).astype(int).astype(str)
allst = allst.drop_duplicates("k").drop(columns="k").reset_index(drop=True)
print(allst["mode"].value_counts().to_string())

SETS = {
    "toate": allst,
    "tramvai": allst[allst["mode"] == "tramvai"],
    "metropolitan": allst[allst["mode"] == "autobuz metropolitan"],
    "scenariu_tren": pd.concat([allst, tm.assign(lines=1)], ignore_index=True),
}
for k, v in SETS.items():
    v = gpd.GeoDataFrame(v, crs=3844).reset_index(drop=True)
    v["name"] = v["name"].fillna("")
    v.to_file(f"data/stops_{k}.geojson", driver="GeoJSON")
    print(k, len(v))
