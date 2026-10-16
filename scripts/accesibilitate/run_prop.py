import sys, time, geopandas as gpd, madina as md, madina.una.tools as una
pop = gpd.read_file("/home/claude/zmi/access_pop_zmi.gpkg")
for s in ["a1_tren_v1","a2_tren_aero","b_trasee","c_r1","d_r2"]:
    t=time.time(); z=md.Zonal()
    z.load_layer("network","/home/claude/zmi/data/network.geojson"); z.load_layer("stops",f"data/stops_{s}.geojson"); z.load_layer("pop","/home/claude/zmi/data/pop.geojson")
    z.create_street_network(source_layer="network",node_snapping_tolerance=1.0)
    z.insert_node(layer_name="stops",label="origin"); z.insert_node(layer_name="pop",label="destination"); z.create_graph()
    una.accessibility(z,search_radius=1500,closest_facility=True,save_closest_facility_as=f"near_{s}",save_closest_facility_distance_as=f"dist_{s}")
    pop[f"dist_{s}"]=z["pop"].gdf[f"dist_{s}"].values; pop.to_file("access_pop_prop.gpkg",driver="GPKG")
    print(f"### {s} {time.time()-t:.0f}s",file=sys.stderr,flush=True)
# facilities (art. 21 b) for proposed stops
import pandas as pd
allp=pd.concat([gpd.read_file(f"data/stops_{s}.geojson") for s in ["a1_tren_v1","a2_tren_aero","b_trasee","c_r1","d_r2"]],ignore_index=True)
gpd.GeoDataFrame(allp,crs=3844).to_file("data/stops_all_prop.geojson",driver="GeoJSON")
z=md.Zonal(); z.load_layer("network","/home/claude/zmi/data/network.geojson"); z.load_layer("stops","data/stops_all_prop.geojson"); z.load_layer("dot","/home/claude/clasif/data/dotari.geojson")
z.create_street_network(source_layer="network",node_snapping_tolerance=1.0); z.insert_node(layer_name="stops",label="origin"); z.insert_node(layer_name="dot",label="destination"); z.create_graph()
una.accessibility(z,search_radius=1500,closest_facility=True,save_closest_facility_as="near_p",save_closest_facility_distance_as="dist_prop")
z["dot"].gdf.to_file("dotari_dist_prop.gpkg",driver="GPKG")
print("DONE",file=sys.stderr)
