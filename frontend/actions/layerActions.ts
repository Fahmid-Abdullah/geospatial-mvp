"use server"
import { supabase } from "@/lib/supabaseClient";
import { FeatureLayerType, FeatureType, LayerOrderType, LayerType } from "@/types/tableTypes";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeoJsonProperties
} from "geojson";

export type GeoJSONInput =
  | FeatureCollection<Geometry, GeoJsonProperties>
  | Feature<Geometry, GeoJsonProperties>;

export async function GetProjectLayers({ project_id } : { project_id: string }): Promise<LayerType[]> {
    const { data, error } = await supabase
        .from("layers")
        .select("id, name, is_visible, order_index, style_color, style_opacity, style_size")
        .eq("project_id", project_id)
        .order("order_index");

    if (error) {
        console.error("Layer Fetch Error:", error);
        throw error;
    }

    return data ?? [];
}


export async function GetProjectLayerFeatures({ project_id } : { project_id: string }): Promise<FeatureLayerType[]> {
  // 1️⃣ Get all layers for the project
  const { data: layerData, error: layerError } = await supabase
    .from("layers")
    .select("id, name, is_visible, order_index, style_color, style_opacity, style_size")
    .eq("project_id", project_id)
    .order("order_index");

  if (layerError) {
    console.error("Layer Fetch Error:", layerError);
    throw layerError;
  }

  if (!layerData?.length) return [];

  // 2️⃣ Fetch features in chunks to avoid row limits
  const chunkSize = 1000; // adjust if needed
  const features: FeatureType[] = [];
  const layerIds = layerData.map(l => l.id);

  let offset = 0;
  while (true) {
    const { data: chunk, error: featuresError } = await supabase
      .from("features")
      .select("id, layer_id, properties, geom, is_visible")
      .in("layer_id", layerIds)
      .range(offset, offset + chunkSize - 1);

    if (featuresError) {
      console.error("Features Fetch Error:", featuresError);
      throw featuresError;
    }

    if (!chunk?.length) break; // no more rows
    features.push(...chunk);
    offset += chunkSize;
  }

  // 3️⃣ Group features by layer
  const featureLayers: FeatureLayerType[] = layerData.map(layer => ({
    layer,
    features: features.filter(f => f.layer_id === layer.id)
  }));

  return featureLayers;
}

export async function CreateLayer({ project_id, layer_name } : { project_id: string, layer_name: string }): Promise<LayerType> {
    const { data, error } = await supabase.from("layers").select("id").eq("project_id", project_id);
    if (error) {
        console.error("Layer Fetch Error:", error);
        throw error;
    }

    let lastLayerOrderIndex;

    if (data) {
      lastLayerOrderIndex = data.length;
    } else {
      lastLayerOrderIndex = 0;
    }

    const { data: newLayer, error: newLayerError } = await supabase
        .from("layers")
        .insert({ 
            project_id: project_id, 
            name: layer_name,
            is_visible: true,
            order_index: lastLayerOrderIndex + 1,
            style_color: "#3b82f6",
            style_opacity: 0.8,
            style_size: 2
         })
        .select("id, name, is_visible, order_index, style_color, style_opacity, style_size")
        .single();

    if (newLayerError) {
        console.error("Layer Create Error:", newLayerError);
        throw newLayerError;
    }

    return newLayer ?? null;
}

export async function UpdateLayer({ layer_id, layer_name, order_index, style_color, style_opacity, style_size } : 
    { layer_id: string, layer_name: string, order_index: number, style_color: string, style_opacity: number, style_size: number }) : Promise<LayerType> {
  const { data, error } = await supabase
    .from("layers")
    .update({
      name: layer_name,
      order_index,
      style_color,
      style_opacity,
      style_size
    })
    .eq("id", layer_id)
    .select("id, name, is_visible, order_index, style_color, style_opacity, style_size")
    .single();

  if (error) {
    console.error("Layer Update Error:", error);
    throw error;
  }

  return data ?? null;
}

export async function UpdateLayerOrder({ layersOrdered } : { layersOrdered: LayerOrderType[] }): Promise<void> {
  if (!layersOrdered || layersOrdered.length < 1) {
    throw new Error("No layers provided.");
  }

  // Map to the format your RPC expects
  // layer_id as string, order_index as int
  const rpcPayload = layersOrdered.map(l => ({
    id: l.layer_id,
    order_index: l.order_index,
  }));

  const { error } = await supabase.rpc("update_layer_order", {
    p_order: rpcPayload,
  });

  if (error) {
    console.error("Update Layer Order Error:", error);
    throw error;
  }
}

export async function UpdateLayerVisibility({ layer_id, layer_isvisible } : { layer_id: string, layer_isvisible: boolean }) {
      const { data, error } = await supabase
    .from("layers")
    .update({
      is_visible: layer_isvisible,
    })
    .eq("id", layer_id)
    .select("id, name, is_visible, style_color, style_opacity, style_size")
    .single();

  if (error) {
    console.error("Layer Visibility Update Error:", error);
    throw error;
  }

    return data ?? null
}

export async function DeleteLayer({ layer_id } : { layer_id: string }): Promise<void> {
  const { error } = await supabase
    .from("layers")
    .delete()
    .eq("id", layer_id)

  if (error) {
    console.error("Project Delete Error:", error);
    throw error;
  }
}

export async function UploadFile( { geojson, layer_name, project_id }: { geojson: GeoJSONInput, layer_name: string, project_id: string }) {
  const features =
    geojson.type === "FeatureCollection" ? geojson.features : [geojson];

  if (!features.length) return null;

  const layer = await CreateLayer({ project_id, layer_name });
  if (!layer) throw new Error("Layer Create Error");

  await supabase.rpc("drop_features_geom_index");

  try {
    const CHUNK_SIZE = 500;

    for (let i = 0; i < features.length; i += CHUNK_SIZE) {
      const { error } = await supabase.rpc("insert_features_bulk", {
        layer_id: layer.id,
        p_features: features.slice(i, i + CHUNK_SIZE)
      });

      if (error) throw error;
    }
  } finally {
    // always recreate index
    await supabase.rpc("create_features_geom_index");
  }

  return layer;
}


export async function UploadPng({}) { // PNG

}