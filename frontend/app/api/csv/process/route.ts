// app/api/csv/process/route.ts
import { NextRequest, NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { supabase } from "@/lib/supabaseClient";
import { CreateLayer } from "@/actions/layerActions";
import { LayerType } from "@/types/tableTypes";

export async function POST(req: NextRequest) {
  try {
    const { project_id, csv_text, latCol, lonCol, includedCols, fileName } = await req.json();

    if (!project_id || !csv_text) {
      return NextResponse.json({ error: "Missing project_id or CSV text" }, { status: 400 });
    }

    // Parse CSV
    const records = parse(csv_text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];

    if (records.length === 0) return NextResponse.json({ error: "CSV is empty" }, { status: 400 });

    // Validate required columns exist
    const missingCols = [latCol, lonCol].filter(c => !Object.keys(records[0]).includes(c));
    if (missingCols.length) return NextResponse.json({ error: `Missing columns: ${missingCols.join(", ")}` }, { status: 400 });

    // Filter points
    const points = records
      .map(row => {
        const lat = parseFloat(row[latCol]);
        const lon = parseFloat(row[lonCol]);
        if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

        return {
          lat,
          lon,
          properties: Object.fromEntries(
            Object.entries(row).filter(([k]) => includedCols.includes(k))
          ),
        };
      })
      .filter(Boolean);

    if (!points.length) return NextResponse.json({ error: "No valid points found" }, { status: 400 });

    // Create a new layer using the server action
    const layerName = fileName ? fileName.replace(/\.[^/.]+$/, "") : `Layer_${Date.now()}`;
    const newLayer: LayerType = await CreateLayer({
      project_id,
      layer_name: layerName,
    });

    // Insert points via RPC
    const { error: rpcError } = await supabase.rpc("insert_features_from_csv", {
      p_layer_id: newLayer.id,
      p_points: points,
    });

    if (rpcError) throw rpcError;

    return NextResponse.json({ message: "Layer created and features inserted", layer: newLayer });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 });
  }
}