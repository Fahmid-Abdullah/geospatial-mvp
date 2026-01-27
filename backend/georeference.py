# conda activate geo
# python georef_service.py
# PROD: gunicorn georef_service:app --workers 1 --threads 4 --timeout 300

from dotenv import load_dotenv
load_dotenv()

import os
import math
import tempfile
import requests
import shutil

from flask import Flask, request, jsonify
from flask_cors import CORS
from osgeo import gdal
from supabase import create_client


# ---------------- GDAL CONFIG ----------------
gdal.UseExceptions()

# Critical for large / complex warps
gdal.SetConfigOption("GDAL_CACHEMAX", "512")          # MB
gdal.SetConfigOption("GDAL_NUM_THREADS", "ALL_CPUS")
gdal.SetConfigOption("VSI_CACHE", "TRUE")
gdal.SetConfigOption("VSI_CACHE_SIZE", "100000000")  # ~100MB


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
    """Order GCPs clockwise to stabilize TPS warp"""
    cx = sum(g["px"] for g in gcps) / len(gcps)
    cy = sum(g["py"] for g in gcps) / len(gcps)

    return sorted(
        gcps,
        key=lambda g: math.atan2(g["py"] - cy, g["px"] - cx),
    )


def valid_file(path, min_bytes=2048):
    return (
        path
        and os.path.exists(path)
        and os.path.getsize(path) > min_bytes
    )


def extract_bounds(ds):
    """Return bounds for MapLibre image source (EPSG:4326)"""
    gt = ds.GetGeoTransform()
    width = ds.RasterXSize
    height = ds.RasterYSize

    min_lng = gt[0]
    max_lat = gt[3]
    max_lng = gt[0] + width * gt[1]
    min_lat = gt[3] + height * gt[5]  # negative

    return [
        [min_lng, max_lat],   # TL
        [max_lng, max_lat],   # TR
        [max_lng, min_lat],   # BR
        [min_lng, min_lat],   # BL
    ]


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

    gcps = order_gcps_clockwise(gcps)

    workdir = tempfile.mkdtemp(prefix="georef_")

    try:
        input_path = os.path.join(workdir, "input.tif")
        gcp_path = os.path.join(workdir, "with_gcps.tif")
        warped_path = os.path.join(workdir, "warped.tif")

        # ---- Download image (streamed, safe for large files) ----
        with requests.get(signed_url, stream=True, timeout=60) as r:
            r.raise_for_status()
            with open(input_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    f.write(chunk)

        # ---- Build GCPs ----
        gdal_gcps = [
            gdal.GCP(g["lon"], g["lat"], 0, g["px"], g["py"])
            for g in gcps
        ]

        ds = gdal.Open(input_path, gdal.GA_ReadOnly)
        if ds is None:
            raise RuntimeError("GDAL failed to open source image")

        # ---- Attach GCPs ----
        gdal.Translate(
            gcp_path,
            ds,
            GCPs=gdal_gcps,
            outputType=gdal.GDT_Byte,
        )

        # ---- Warp (TPS, stabilized) ----
        warp_ds = gdal.Warp(
            warped_path,
            gcp_path,
            dstSRS="EPSG:4326",
            tps=True,
            multithread=True,
            resampleAlg="bilinear",
            warpOptions=["NUM_THREADS=ALL_CPUS"],
        )

        if warp_ds is None:
            raise RuntimeError("GDAL Warp failed")

        if not valid_file(warped_path):
            raise RuntimeError("Warp output invalid or empty")
        
        # ---- Convert warped TIFF to PNG for browser ----
        png_path = os.path.join(workdir, "warped.png")
        gdal.Translate(
            png_path,
            warp_ds,
            format="PNG",       # output format
            outputType=gdal.GDT_Byte
        )

        bounds = extract_bounds(warp_ds)

    except Exception as e:
        return jsonify({
            "error": "Georeferencing failed",
            "detail": str(e),
        }), 500

    finally:
        # Close datasets explicitly (important for GDAL)
        try:
            ds = None
            warp_ds = None
        except Exception:
            pass

    # ---------------- UPLOAD ----------------
    filename = f"georef/{project_id}.png"
    bucket = supabase.storage.from_("rasters")

    try:
        bucket.remove([filename])
    except Exception:
        pass

    with open(png_path, "rb") as f:
        bucket.upload(
            filename,
            f,
            {"content-type": "image/png"},
        )

    signed = bucket.create_signed_url(filename, 300)

    # Cleanup disk
    shutil.rmtree(workdir, ignore_errors=True)

    return jsonify({
        "signedUrl": signed["signedURL"],
        "bounds": bounds,
    })


# ---------------- RUN ----------------
if __name__ == "__main__":
    # Dev only — use gunicorn for real workloads
    app.run(host="0.0.0.0", port=5000, debug=True)
