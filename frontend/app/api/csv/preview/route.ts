import { parse } from "csv-parse/sync";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File;

    const text = await file.text();

    const records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true
    }) as Record<string, string>[];

    const headers = Object.keys(records[0] ?? {});
    const previewRows = records.slice(0, 10);

    return NextResponse.json({
      headers,
      previewRows,
      tempCsvText: text // temporary, short-term only
    });
  } catch (err: any) {
      console.error(err);
      return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 });
    }
}
