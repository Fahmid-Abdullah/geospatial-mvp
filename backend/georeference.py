# conda activate geo
# python georef_service.py

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, request, jsonify
from flask_cors import CORS
import tempfile
import requests
import os
import math

from osgeo import gdal
from supabase import create_client

# ---------------- GDAL CONFIG ----------------
gdal.UseExceptions()

# ---------------- ENV ----------------
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---------------- APP ----------------
app = Flask(__name__)
CORS(app, origins=["http://localhost:3000"])


# ---------------- HELPERS ----------------
def order_gcps_clockwise(gcps):
    cx = sum(g["px"] for g in gcps) / len(gcps)
    cy = sum(g["py"] for g in gcps) / len(gcps)

    return sorted(
        gcps,
        key=lambda g: math.atan2(g["py"] - cy, g["px"] - cx)
    )


def valid_file(path, min_bytes=1024):
    return (
        path
        and os.path.exists(path)
        and os.path.getsize(path) > min_bytes
    )


# ---------------- ROUTES ----------------
@app.route("/georef", methods=["POST"])
def georef():
    data = request.json or {}

    signed_url = data.get("signedUrl")
    gcps = data.get("gcps")
    project_id = data.get("projectId")

    if not signed_url or not gcps or not project_id:
        return jsonify({"error": "Missing signedUrl, gcps, or projectId"}), 400

    if len(gcps) < 4:
        return jsonify({"error": "At least 4 GCPs required"}), 400

    # ---- Order GCPs to avoid homography failures ----
    gcps = order_gcps_clockwise(gcps)

    try:
        # ---- Download image ----
        tmp_input = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
        r = requests.get(signed_url, timeout=30)
        r.raise_for_status()
        tmp_input.write(r.content)
        tmp_input.close()

        # ---- Temp outputs ----
        tmp_output = tempfile.NamedTemporaryFile(delete=False, suffix=".tif").name
        tmp_warped = tempfile.NamedTemporaryFile(delete=False, suffix=".tif").name

        # ---- Build GDAL GCPs ----
        gdal_gcps = [
            gdal.GCP(g["lon"], g["lat"], 0, g["px"], g["py"])
            for g in gcps
        ]

        ds = gdal.Open(tmp_input.name)
        if ds is None:
            raise RuntimeError("GDAL failed to open image")

        # ---- Attach GCPs ----
        gdal.Translate(tmp_output, ds, GCPs=gdal_gcps)

        # ---- Warp using TPS (much more stable than homography) ----
        warp_ds = gdal.Warp(
            tmp_warped,
            tmp_output,
            dstSRS="EPSG:4326",
            tps=True
        )

        if warp_ds is None:
            raise RuntimeError("GDAL Warp failed")

        # ---- Validate output BEFORE upload ----
        if not valid_file(tmp_warped):
            raise RuntimeError("Warp output invalid or empty")

    except Exception as e:
        return jsonify({
            "error": "Georeferencing failed",
            "detail": str(e)
        }), 500

    # ---------------- UPLOAD (ONLY AFTER SUCCESS) ----------------
    filename = f"georef/{project_id}.tif"
    bucket = supabase.storage.from_("rasters")

    try:
        bucket.remove([filename])  # safe overwrite
    except Exception:
        pass

    with open(tmp_warped, "rb") as f:
        bucket.upload(
            filename,
            f,
            {"content-type": "image/tiff"}
        )

    signed = bucket.create_signed_url(filename, 300)

    return jsonify({
        "signedUrl": signed["signedURL"]
    })

# ---------------- RUN ----------------
if __name__ == "__main__":
    app.run(debug=True, port=5000)
