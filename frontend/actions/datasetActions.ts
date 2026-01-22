import { supabase } from "@/lib/supabaseClient";

// Inserts into datasets
export async function createDataset({ name } : { name: string }): Promise<string> {
    try {
        const { data, error } = await supabase
            .from("datasets")
            .insert({
                name,
                status: 'created'
            })
            .select("id")
            .single();

        if (error) {
            console.error("Dataset Insert Error:", error);
            throw error;
        }

        return data.id;
    } catch (error) {
        console.error("Dataset Create Error:", error);
        throw error;
    }
}

// Parse CSV (PapaParse or csv-parse)
// Extract headers + first N rows
// Store parsed rows temporarily (memory or temp table)
// Update dataset → csv_uploaded
export async function uploadCSV(dataset_id: any, file: any) {

}

// Validate numeric + bounds
// Insert rows into dataset_points
// Update dataset → points_ready
export async function finalizeCSVWithCoords(dataset_id: any, lonCol: any, latCol: any) {

}

// Libraries used here ONLY
    // GDAL (for GCP + warp)
    // Rasterio (to extract transform + bounds)

// Does:
    // Save image
    // Apply GCPs
    // Generate GeoTIFF
    // Extract:
        // CRS
        // Transform
        // Bounds
    // Store in dataset_images
    // Update dataset → image_aligned
export async function uploadAndGeoreferenceImage(dataset_id: any, image: any, controlPoints: any) {

}

// Libraries
    // Rasterio ONLY
// Does:
    // Read transform
    // Convert pixel → lon/lat
    // Cache result temporarily
    // Does NOT insert into DB yet
export async function addPointForRow(dataset_id: any, rowIndex: any, pixelX: any, pixelY: any) {

}

// Does:
    // Insert into dataset_points
    // Clear temp CSV data
    // Update dataset → points_ready
export async function finalizePlacedPoints(dataset_id: any, points: any[]) {

}

// Checks for broken states
export async function assertDatasetStatus(dataset_id: any, allowedStatuses: any[]) {

}