import geopandas as gpd, madina as md, madina.una.tools as una
pop=gpd.read_file("access_pop_prop.gpkg")
z=md.Zonal(); z.load_layer("network","/home/claude/zmi/data/network.geojson"); z.load_layer("stops","data/stops_cf_existent.geojson"); z.load_layer("pop","/home/claude/zmi/data/pop.geojson")
z.create_street_network(source_layer="network",node_snapping_tolerance=1.0); z.insert_node(layer_name="stops",label="origin"); z.insert_node(layer_name="pop",label="destination"); z.create_graph()
una.accessibility(z,search_radius=1500,closest_facility=True,save_closest_facility_as="near_cf",save_closest_facility_distance_as="dist_cf")
pop["dist_cf"]=z["pop"].gdf["dist_cf"].values; pop.to_file("access_pop_prop.gpkg",driver="GPKG"); print("ok")
