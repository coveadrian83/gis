"""Madina UNA on ZMI: stops = origins, population points (WorldPop 100 m) = destinations.
 - closest_facility (R=1500 m): network distance from each population point to nearest stop
 - reach weighted by pop2020 (R=500 m): residents within a 500 m walk of each stop
"""
import sys, time, geopandas as gpd, pandas as pd, madina as md, madina.una.tools as una

SETS = sys.argv[1:] or ["toate", "tramvai", "metropolitan", "scenariu_tren"]
pop = gpd.read_file("access_pop_zmi.gpkg") if len(sys.argv)>1 else gpd.read_file("data/pop.geojson")
stops_out = []

def zonal(s):
    z = md.Zonal()
    z.load_layer("network", "data/network.geojson")
    z.load_layer("stops", f"data/stops_{s}.geojson")
    z.load_layer("pop", "data/pop.geojson")
    z.create_street_network(source_layer="network", node_snapping_tolerance=1.0)
    z.insert_node(layer_name="stops", label="origin")
    z.insert_node(layer_name="pop", label="destination")
    z.create_graph()
    return z

for s in SETS:
    t = time.time()
    z = zonal(s)
    una.accessibility(z, search_radius=1500, closest_facility=True,
                      save_closest_facility_as=f"near_{s}", save_closest_facility_distance_as=f"dist_{s}")
    pop[f"dist_{s}"] = z["pop"].gdf[f"dist_{s}"].values
    pop.to_file("access_pop_zmi.gpkg", driver="GPKG")
    if s != "scenariu_tren":
        z = zonal(s)
        una.accessibility(z, search_radius=500, destination_weight="pop2020", save_reach_as="pop_500m")
        g = z["stops"].gdf.copy(); g["set"] = s
        stops_out.append(g[["set", "mode", "name", "lines", "pop_500m", "geometry"]])
        gpd.GeoDataFrame(pd.concat(stops_out), crs=3844).to_file("access_stops_zmi.gpkg", driver="GPKG")
    print(f"\n### {s}: {time.time()-t:.0f}s", file=sys.stderr, flush=True)
print("DONE", file=sys.stderr)
