"use server";
import { supabase } from "@/lib/supabaseClient";
import { FeatureType } from "@/types/tableTypes";
import type { Geometry, GeoJsonProperties } from "geojson";

export async function GetLayerFeatures({ layer_id } : { layer_id: string }): Promise<FeatureType[]> {
  const { data, error } = await supabase
    .from("features")
    .select("id, layer_id, properties, geom, is_visible")
    .eq("layer_id", layer_id);

    if (error) {
      console.error("Feature Fetch Error:", error);
      throw error;
    }

    return data ?? []
}

export async function CreateFeature({ layer_id, feature_properties, feature_geom } : 
  { layer_id: string, feature_properties: GeoJsonProperties, feature_geom: Geometry }) : Promise<FeatureType> {
  const { data, error } = await supabase
    .from("features")
    .insert({
      layer_id: layer_id,
      properties: feature_properties,
      geom: feature_geom,
      is_visible: true,
    })
    .select("id, layer_id, properties, geom, is_visible")
    .single();

    if (error) {
      console.error("Feature Insert Error:", error);
      throw error;
    }

    return data ?? null
}

export async function UpdateFeature({ feature_id, feature_properties, feature_geom } : 
  { feature_id: string, feature_properties: GeoJsonProperties, feature_geom: Geometry }) : Promise<FeatureType> {
  const { data, error } = await supabase
    .from("features")
    .update({
      properties: feature_properties,
      geom: feature_geom,
    })
    .eq("id", feature_id)
    .select("id, layer_id, properties, geom, is_visible")
    .single();

    if (error) {
      console.error("Feature Update Error:", error);
      throw error;
    }

    return data ?? null
}

export async function UpdateFeatureVisibility({ feature_id, feature_isvisible } : { feature_id: string, feature_isvisible: boolean }) : Promise<FeatureType> {
  const { data, error } = await supabase
    .from("features")
    .update({
      is_visible: feature_isvisible,
    })
    .eq("id", feature_id)
    .select("id, layer_id, properties, geom, is_visible")
    .single();

    if (error) {
      console.error("Feature Visibility Update Error:", error);
      throw error;
    }

    return data ?? null
}

export async function UpdateAllLayerFeatureVisibility({ layer_id, visibility } : { layer_id: string, visibility: boolean }) : Promise<FeatureType[]> {
  const { data, error } = await supabase
    .from("features")
    .update({
      is_visible: visibility,
    })
    .eq("layer_id", layer_id)
    .select("id, layer_id, properties, geom, is_visible")

    if (error) {
      console.error("Feature Visibility Update Error:", error);
      throw error;
    }

    return data ?? [];
}

export async function DeleteFeature({ feature_id }: { feature_id: string }): Promise<void> {
  const { error } = await supabase.from("features").delete().eq("id", feature_id);

  if (error) {
    console.error("Feature Delete Error:", error);
    throw error;
  }
}