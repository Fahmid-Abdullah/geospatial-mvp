import { supabase } from "@/lib/supabaseClient"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  const { path } = await req.json()

  if (!path) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 })
  }

  const { data, error } = await supabase.storage
    .from("rasters")
    .createSignedUrl(path, 60 * 5) // 5 minutes

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ url: data.signedUrl })
}
