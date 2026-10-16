import sys, geopandas as gpd, pandas as pd, madina as md, madina.una.tools as una
pop=gpd.read_file("access_pop_prop.gpkg")
def Z(stops,dest,label):
    z=md.Zonal(); z.load_layer("network","/home/claude/zmi/data/network.geojson"); z.load_layer("stops",stops); z.load_layer("d",dest)
    z.create_street_network(source_layer="network",node_snapping_tolerance=1.0); z.insert_node(layer_name="stops",label="origin"); z.insert_node(layer_name="d",label="destination"); z.create_graph()
    una.accessibility(z,search_radius=1500,closest_facility=True,save_closest_facility_as="near_x",save_closest_facility_distance_as=label); return z["d"].gdf
g=Z("data/stops_e_intermodal.geojson","/home/claude/zmi/data/pop.geojson","dist_e_intermodal")
pop["dist_e_intermodal"]=g["dist_e_intermodal"].values; pop.to_file("access_pop_prop.gpkg",driver="GPKG")
for tag,sets in [("v1",["a1_tren_v1","b_trasee","c_r1","d_r2","e_intermodal"]),("v2",["a1_tren_v1","a2_tren_aero","b_trasee","c_r1","d_r2","e_intermodal"])]:
    s=gpd.GeoDataFrame(pd.concat([gpd.read_file(f"data/stops_{m}.geojson") for m in sets],ignore_index=True),crs=3844); s.to_file(f"data/stops_{tag}_all.geojson",driver="GeoJSON")
    d=Z(f"data/stops_{tag}_all.geojson","/home/claude/clasif/data/dotari.geojson","dist_prop"); d.to_file(f"dotari_dist_prop_{tag}.gpkg",driver="GPKG")
print("DONE",file=sys.stderr)
