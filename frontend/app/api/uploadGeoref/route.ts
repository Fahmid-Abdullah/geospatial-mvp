export const runtime = "nodejs";

import { supabase } from "@/lib/supabaseClient";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string | null;

    if (!file || !projectId) {
      return NextResponse.json(
        { error: "Missing file or projectId" },
        { status: 400 }
      );
    }

    const ext = file.name.split(".").pop();
    const path = `georef/${projectId}/${crypto.randomUUID()}.${ext}`;

    // Upload to Supabase
    const { error: uploadError } = await supabase.storage
      .from("rasters")
      .upload(path, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Generate signed URL
    const { data, error: accessError } = await supabase.storage
      .from("rasters")
      .createSignedUrl(path, 60 * 5);

    if (accessError) {
      return NextResponse.json({ error: accessError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      path,
      signedUrl: data.signedUrl,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to upload georeferenced raster" }, { status: 500 });
  }
}