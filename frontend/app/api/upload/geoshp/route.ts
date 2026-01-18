export const runtime = "nodejs"; // Needed for shpjs and large buffers

import { CreateLayer, DeleteLayer } from "@/actions/layerActions";
import { supabase } from "@/lib/supabaseClient";
import { NextRequest, NextResponse } from "next/server";
import shp from "shpjs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File;
    const project_id = form.get("project_id") as string;

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    let geojson: any;
    let layer_name = file.name
      .replace(/\.(zip|geojson)$/i, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    // Shapefile zip → GeoJSON
    if (file.name.endsWith(".zip")) {
      const buffer = await file.arrayBuffer();
      geojson = await shp(buffer);
    }

    // GeoJSON
    if (
      file.name.endsWith(".geojson") ||
      file.type === "application/json"
    ) {
      const text = await file.text();
      geojson = JSON.parse(text);
    }

    if (!geojson) {
      return NextResponse.json(
        { error: "Invalid upload format" },
        { status: 400 }
      );
    }

    if (
      geojson.type !== "FeatureCollection" &&
      geojson.type !== "Feature"
    ) {
      return NextResponse.json(
        { error: "Invalid GeoJSON structure" },
        { status: 400 }
      );
    }

    const features =
      geojson.type === "FeatureCollection"
        ? geojson.features
        : [geojson];

    if (!features.length) {
      return NextResponse.json(
        { error: "No features found" },
        { status: 400 }
      );
    }

    const layer = await CreateLayer({ project_id, layer_name });
    if (!layer) throw new Error("Layer creation failed");

    await supabase.rpc("drop_features_geom_index");

    try {
      const CHUNK_SIZE = 100;

      for (let i = 0; i < features.length; i += CHUNK_SIZE) {
        const { error } = await supabase.rpc(
          "insert_features_bulk",
          {
            layer_id: layer.id,
            p_features: features.slice(i, i + CHUNK_SIZE),
          }
        );

        if (error) {
          await DeleteLayer({ layer_id: layer.id });
          return NextResponse.json(
            { error: "File upload failed. Layer Deleted." },
            { status: 400 }
          );
        }
        console.log(`${i} features uploaded.`)
      }
    } finally {
      await supabase.rpc("create_features_geom_index");
    }

    return NextResponse.json({ layer });

  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err.message || "Unknown error" },
      { status: 500 }
    );
  }
}