import { supabase } from "@/lib/supabaseClient"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  const { path } = await req.json()

  if (!path || typeof path !== "string") {
    return NextResponse.json({ error: "Missing path" }, { status: 400 })
  }

  if (!path.startsWith("raw/")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 })
  }

  const { data, error } = await supabase.storage
    .from("rasters")
    .remove([path])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, removed: data })
}
