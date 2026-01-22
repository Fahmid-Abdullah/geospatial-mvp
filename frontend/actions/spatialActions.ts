"use server";
import { supabase } from "@/lib/supabaseClient";

export async function GetParentPolygons(featureId: bigint, projectId: string) {
  const { data, error } = await supabase.rpc("get_parent_polygons", { 
    p_feature_id: featureId,
    p_project_id: projectId
  });
  if (error) throw error;
  return data ?? [];
}

export async function FeaturesWithinPolygon(polygonId: bigint, projectId: string) {
  const { data, error } = await supabase.rpc("features_within_polygon", { 
    p_polygon_id: polygonId,
    p_project_id: projectId
  });
  if (error) throw error;
  return data ?? [];
}

export async function FeaturesIntersectPolygon(polygonId: bigint, projectId: string) {
  const { data, error } = await supabase.rpc("features_intersect_polygon", { 
    p_polygon_id: polygonId,
    p_project_id: projectId
  });
  if (error) throw error;
  return data ?? [];
}

export async function FeaturesWithinDistance(featureId: bigint, distance: number, projectId: string) {
  const { data, error } = await supabase.rpc("features_within_distance", {
    p_feature_id: featureId,
    p_distance: distance,
    p_project_id: projectId
  });
  if (error) throw error;
  return data ?? [];
}

export async function CountFeaturesInPolygons(projectId: string) {
  const { data, error } = await supabase.rpc("count_features_in_polygons", {
    p_project_id: projectId
  });
  if (error) throw error;
  return data ?? [];
}