"use client"

import { UploadFile } from "@/actions/layerActions";
import shp from "shpjs";

type ParseFileProps = {
  file: File,
  project_id: string,
  getFeatureLayers: () => void
}

export default async function ParseFile({ file, project_id, getFeatureLayers }: ParseFileProps) {
    if (!file) return;

    let geojson;
    let layer_name;

    // Convert zipped shapefile → GeoJSON
    if (file.name.endsWith(".zip")) {
        const arrayBuffer = await file.arrayBuffer();
        geojson = await shp(arrayBuffer);
        layer_name = file.name.replace(".zip", "");
    }

    // If it's already GeoJSON
    if (file.name.endsWith(".geojson") || file.type === "application/json") {
        const text = await file.text();
        geojson = JSON.parse(text);
        layer_name = file.name.replace(".geojson", "");
    }

    if (!geojson) {
        console.error("Invalid upload. Please upload a zip or geojson.");
        throw Error("Invalid upload.");
    } else {
        console.log("File uploaded successfully. Validating...");
    }

    if (geojson.type !== "FeatureCollection" && geojson.type !== "Feature") {
        console.error("Something went wrong when validating data.");
        throw Error("Validation failed.");
    } else {
        console.log("Data validated successfully. Uploading...");
    }

    await UploadFile({ geojson, layer_name: layer_name as string, project_id });

    getFeatureLayers();
}