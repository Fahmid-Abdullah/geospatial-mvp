// app/api/csv/convertLatLon/route.ts
import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type EnrichedRow = Record<string, string | number | null> & {
  latitude: number | null;
  longitude: number | null;
};

export async function POST(request: Request) {
  if (!MAPBOX_TOKEN) {
    return NextResponse.json(
      { error: "Missing Mapbox token" },
      { status: 500 }
    );
  }

    const baseUrl = new URL(request.url).origin;

  const { project_id, csv_text, addressCol, includedCols, fileName } =
    await request.json();

  if (!project_id || !csv_text || !addressCol) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // 1️⃣ Parse CSV
  const records = parse(csv_text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  if (!records.length) {
    return NextResponse.json(
      { error: "CSV contains no rows" },
      { status: 400 }
    );
  }

  // 2️⃣ Build Mapbox batch requests (Canada-only)
    const requests = records.map(row => ({
    q: `${row.address}, ${row.city}, ${row.province} ${row.postal_code}, Canada`,
    limit: 1,
    types: ["address"],
    }));


  // 3️⃣ Call Mapbox batch geocoder
  const res = await fetch(
    `https://api.mapbox.com/search/geocode/v6/batch?access_token=${MAPBOX_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requests),
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    return NextResponse.json(
      { error: "Mapbox geocoding failed", details: errorText },
      { status: res.status }
    );
  }

  const geoData = await res.json();

  // 4️⃣ Inject lat/lon into rows
    const enrichedRows: EnrichedRow[] = records.map((row, i) => {
    const feature = geoData.batch?.[i]?.features?.[0]; // ✅ FIX
    const [lon, lat] = feature?.geometry?.coordinates ?? [null, null];

    return {
        ...row,
        latitude: lat,
        longitude: lon,
    };
    });

  // 5️⃣ Rebuild CSV
  const headers = Object.keys(enrichedRows[0]);
  const csvOut =
    headers.join(",") +
    "\n" +
    enrichedRows
      .map(row =>
        headers.map(h => `"${row[h] ?? ""}"`).join(",")
      )
      .join("\n");

  // 6️⃣ Forward to downstream CSV processor
    const processRes = await fetch(
    `${baseUrl}/api/csv/process`,
    {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            project_id,
            csv_text: csvOut,
            latCol: "latitude",
            lonCol: "longitude",
            includedCols,
            fileName,
        }),
        }
    );

  if (!processRes.ok) {
    console.log(processRes);
    console.log("Mapbox payload:", JSON.stringify(requests[0], null, 2));
    console.log("Mapbox response keys:", Object.keys(geoData));
    const errorText = await processRes.text();
    return NextResponse.json(
      { error: "CSV post-processing failed", details: errorText },
      { status: processRes.status }
    );
  }

  const result = await processRes.json();
  return NextResponse.json(result);
}
