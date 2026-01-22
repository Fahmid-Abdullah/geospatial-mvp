"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { MapContext } from "@/context/MapContext";
import { EMPTY_GCPS } from "@/app/dashboard/page";
import { toast } from "react-toastify";
import ImageGCPModal from "./ImageGCPModal";
import { CSVRow, RasterBounds } from "@/types/gcpTypes";

/* ---------------- types ---------------- */

interface GeoRefProps {
  cancelGeoRef: () => Promise<void>;
}

type GeoRefStep = "GEOREF" | "CSV";

/* ---------------- component ---------------- */

export default function GeoRefComponent({ cancelGeoRef }: GeoRefProps) {
  const ctx = useContext(MapContext);
  if (!ctx) return null;

  /* ---------- context ---------- */
  const [projectId] = ctx.selectedProjectState;
  const [imageUrl] = ctx.imageUrlState;
  const [gcps, setGcps] = ctx.gcpPathState;
  const [selectedGcp, setSelectedGcp] = ctx.selectedGcpPathState;
  const [, setRasterUrl] = ctx.rasterUrlState;
  const [, setRasterBounds] = ctx.rasterBounds;
  const [rasterVisibility, setRasterVisibility] = ctx.rasterVisibility;
  const [rasterOpacity, setRasterOpacity] = ctx.rasterOpacity;

  /* ---------- step state ---------- */
  const [step, setStep] = useState<GeoRefStep>("GEOREF");
  const [geoRefSuccess, setGeoRefSuccess] = useState(false);
  const [csvMode, setCsvMode] = useState<"SETTING" | "REVIEW">("REVIEW");

  /* ---------- local state ---------- */
  const [activeImageGcpIndex, setActiveImageGcpIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [imageExpired, setImageExpired] = useState(false);

  /* ---------- CSV state ---------- */
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = ctx.csvRows;
  const [activeCSVRow, setActiveCSVRow] = useState<number | null>(null);

  const expiryIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /* ---------------- helpers ---------------- */

  const checkImageUrlValid = async (): Promise<boolean> => {
    if (!imageUrl) return false;
    try {
      const res = await fetch(imageUrl, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  };

  /* ---------------- image lifecycle ---------------- */

  useEffect(() => {
    if (!imageUrl) return;

    let cancelled = false; // safety flag for async
    const lastImageRef = { current: "" }; // track last initialized image

    const init = async () => {
      const valid = await checkImageUrlValid();

      if (cancelled) return;
      if (!valid) {
        toast.error("Image URL has expired. Please reupload.");
        setImageExpired(true);
        await cancelGeoRef();
        return;
      }

      setGcps((prev) => {
        const isNewImage = lastImageRef.current !== imageUrl;
        lastImageRef.current = imageUrl;
        if (isNewImage && prev.every((g) => g.px === null && g.py === null)) {
          return EMPTY_GCPS;
        }
        return prev;
      });
    };

    init();

    // Interval to check if image has expired
    expiryIntervalRef.current = setInterval(async () => {
      const valid = await checkImageUrlValid();
      if (cancelled) return;
      if (!valid) {
        toast.error("Image URL expired.");
        setImageExpired(true);
        clearInterval(expiryIntervalRef.current!);
        await cancelGeoRef();
      }
    }, 60_000);

    return () => {
      cancelled = true;
      if (expiryIntervalRef.current) clearInterval(expiryIntervalRef.current);
    };
  }, [imageUrl, cancelGeoRef, setGcps]);

  /* ---------------- derived state ---------------- */

  const canGeoreference = useMemo(
    () =>
      gcps.every(
        (g) =>
          g.px !== null &&
          g.py !== null &&
          g.lon !== null &&
          g.lat !== null
      ),
    [gcps]
  );

  /* ---------------- mutations ---------------- */

  const updateImagePoint = (index: number, px: number | null, py: number | null) => {
    setGcps((prev) =>
      prev.map((g, i) => (i === index ? { ...g, px, py } : g))
    );
  };

  const handleGeoreference = async () => {
    if (!canGeoreference || !imageUrl || !projectId) return;
    setSelectedGcp(null);

    setLoading(true);
    try {
      const res = await fetch("http://localhost:5000/georef", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedUrl: imageUrl,
          gcps,
          projectId: projectId.id,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.signedUrl || !data?.bounds) {
        throw new Error();
      }

      setRasterUrl(data.signedUrl);
      setRasterBounds(data.bounds as RasterBounds);

      toast.success("Image georeferenced!");
      setGeoRefSuccess(true);
    } catch {
      toast.error("Georeferencing failed");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- CSV upload ---------------- */

  const uploadCSV = async (file: File) => {
    const form = new FormData();
    form.append("file", file);

    const res = await fetch("/api/csv/preview", {
      method: "POST",
      body: form,
    });

    const data = await res.json();

    setCsvHeaders([...data.headers, "Coordinates"]);
    setCsvRows(data.previewRows.map((r: any) => ({ ...r })));
    setCsvMode("REVIEW");
    setActiveCSVRow(null);
  };


  useEffect(() => {
    const map = ctx.mapRef.current;
    if (!map || csvMode !== "SETTING" || activeCSVRow === null) return;

    const handler = (e: maplibregl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;

      setCsvRows((prev) => {
        const next = [...prev];
        next[activeCSVRow] = {
          ...next[activeCSVRow],
          __coord: { lon: lng, lat },
        };
        return next;
      });

      setActiveCSVRow(null);
      setCsvMode("REVIEW");
      toast.success("Coordinate attached");
    };

    map.on("click", handler);

    return () => {
      map.off("click", handler);
    };
  }, [csvMode, activeCSVRow, ctx.mapRef]);
  
  const csvEscape = (value: any) => {
    const s = String(value ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  // Format CSV content + lat/lon
  const buildCSVText = () => {
    const LAT_COL = "__lat";
    const LON_COL = "__lon";

    const headers = [
      ...csvHeaders.filter((h) => h !== "Coordinates"),
      LAT_COL,
      LON_COL,
    ];

    const lines = [
      headers.join(","), // header row
      ...csvRows.map((row) =>
        headers
          .map((h) => {
            if (h === LAT_COL) return row.__coord!.lat;
            if (h === LON_COL) return row.__coord!.lon;
            return csvEscape(row[h]);
          })
          .join(",")
      ),
    ];

    return {
      csvText: lines.join("\n"),
      latCol: LAT_COL,
      lonCol: LON_COL,
      includedCols: headers.filter(
        (h) => h !== LAT_COL && h !== LON_COL
      ),
    };
  };

  // Save formatted CSV content
  const handleSave = async () => {
    if (!projectId) return;

    try {
      setLoading(true);

      const { csvText, latCol, lonCol, includedCols } = buildCSVText();

      const res = await fetch("/api/csv/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId.id,
          csv_text: csvText,
          latCol,
          lonCol,
          includedCols,
          fileName: "uploaded_points.csv",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("CSV points added as layer!");

      // RESET LOGIC AFTER SUCCESS
          
      // 1. Clear the temporary Raster overlay state
      setRasterUrl(null);
      setRasterBounds(null);

      // 2. Clear Georeferencing Control Points (GCPs) state
      // This removes the blue/yellow markers from the map
      setGcps(EMPTY_GCPS);
      setSelectedGcp(null);

      // 3. Clear CSV Rows state
      // This removes the "Attach Coordinate" markers/list
      setCsvRows([]);
      setActiveCSVRow(null);

      // 4. Exit Georeferencing mode (runs the cleanup provided by parent)
      await cancelGeoRef();
    } catch (err: any) {
      toast.error(err.message || "Failed to process CSV");
    } finally {
      setLoading(false);
    }
  };


  const getPointButtonState = (rowIndex: number, hasCoord: boolean) => {
    if (csvMode === "SETTING" && activeCSVRow === rowIndex) {
      return {
        label: "Editing point",
        className: "bg-orange-500 cursor-default",
        disabled: true,
      };
    }

    if (hasCoord) {
      return {
        label: "Edit point",
        className: "bg-yellow-500 hover:bg-yellow-600",
        disabled: false,
      };
    }

    return {
      label: "Set point",
      className: "bg-blue-600 hover:bg-blue-700",
      disabled: false,
    };
  };

  /* ---------------- render ---------------- */

  const renderGeoRefStep = () => {
    const allGcpsSet = canGeoreference;

    return (
      <div className="mt-8 space-y-6">
        {/* Step instruction */}
        <div className="bg-indigo-50 border-l-4 border-indigo-500 p-4 rounded-xl">
          <h2 className="text-lg font-semibold">Step 1: Georeference Your Image</h2>
          <p className="text-sm text-gray-700 mt-1">
            For each control point (GCP), click <span className="font-semibold">Set Image</span> to mark
            its position on the uploaded image, then click <span className="font-semibold">Set Map</span> 
            to select its real-world location on the map.
          </p>
        </div>

        {/* GCP Cards */}
        <div className="space-y-4">
          {gcps.map((gcp, i) => {
            const imageSet = gcp.px !== null && gcp.py !== null;
            const mapSet = gcp.lon !== null && gcp.lat !== null;
            const isSelected = selectedGcp?.id === gcp.id;

            return (
              <div
                key={gcp.id}
                className={`rounded-xl border p-4 shadow-sm transition hover:shadow-md ${
                  imageSet && mapSet ? "bg-yellow-50 border-yellow-300" : "bg-white"
                }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-semibold">GCP {i + 1}</h4>
                    <div className="text-sm mt-2 space-y-1">
                      <div>
                        Image:{" "}
                        {imageSet ? (
                          <span className="text-green-600">({gcp.px!.toFixed(2)}, {gcp.py!.toFixed(2)})</span>
                        ) : (
                          <span className="text-red-400">Not set</span>
                        )}
                      </div>
                      <div>
                        Map:{" "}
                        {mapSet ? (
                          <span className="text-green-600">({gcp.lon!.toFixed(6)}, {gcp.lat!.toFixed(6)})</span>
                        ) : (
                          <span className="text-red-400">Not set</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setActiveImageGcpIndex(i)}
                      className={`px-4 py-1 rounded text-white text-sm transition ${
                        imageSet ? "bg-yellow-500 hover:bg-yellow-600" : "bg-blue-600 hover:bg-blue-700"
                      }`}
                    >
                      {imageSet ? "Edit Image" : "Set Image"}
                    </button>

                    <button
                      onClick={() => setSelectedGcp(gcp)}
                      className={`px-4 py-1 rounded text-white text-sm transition ${
                        isSelected || mapSet ? "bg-yellow-500 hover:bg-yellow-600" : "bg-gray-500 hover:bg-gray-600"
                      }`}
                    >
                      {mapSet ? "Edit Map" : "Set Map"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Georeference / Next Buttons */}
        <div className="space-y-2">
          <button
            disabled={!allGcpsSet || loading}
            onClick={handleGeoreference}
            className={`w-full py-2 rounded text-white text-sm transition ${
              allGcpsSet
                ? "bg-green-600 hover:bg-green-700"
                : "bg-gray-300 cursor-not-allowed"
            }`}
          >
            {loading ? "Processing…" : "Georeference Image"}
          </button>

          {geoRefSuccess && (
            <button
              onClick={() => { setStep("CSV"); setSelectedGcp(null); }}
              className="w-full py-2 rounded text-white bg-blue-600 hover:bg-blue-700 text-sm"
            >
              Next: Attach CSV Coordinates
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderCSVStep = () => {
    const allCoordsSet = csvRows.every((r) => r.__coord);

    return (
      <div className="mt-4 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Attach Coordinates</h2>
          <button
            onClick={() => {
              setCsvMode("REVIEW");
              setActiveCSVRow(null);
              setStep("GEOREF");
            }}
            className="text-sm text-blue-600 hover:underline"
          >
            ← Back
          </button>
        </div>

        {/* Upload */}
          <label
            htmlFor="upload-csv"
            className={`
              relative flex flex-col items-center justify-center gap-2
              border border-gray-300 rounded-xl px-5 py-3
              bg-white hover:bg-gray-50 active:bg-gray-100
              shadow-sm hover:shadow-md
              cursor-pointer transition-all duration-200
              w-full sm:w-auto
            `}
          >
            {/* CSV badge */}
            <span className="absolute -top-2 left-4 bg-white text-xs font-medium px-2">
              CSV
            </span>

            {/* Icon */}
            <i className="fa-solid fa-file-csv text-xl text-green-600" />

            {/* Text */}
            <span className="text-sm font-medium text-gray-700">
              {loading ? "Uploading..." : "Click to upload CSV"}
            </span>

            {/* Hidden input */}
            <input
              id="upload-csv"
              type="file"
              disabled={loading}
              accept=".csv"
              onChange={(e) => e.target.files && uploadCSV(e.target.files[0])}
              className="hidden"
            />
          </label>


        {/* Layer Controls */}
        <div className="rounded-xl border p-4 bg-white shadow-sm space-y-4">
          <h3 className="font-semibold text-sm">Layer Settings</h3>

          {/* Visibility */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rasterVisibility}
              onChange={(e) => {
                const val = e.target.checked;
                setRasterVisibility(val);
              }}
              className="w-4 h-4 rounded border-gray-300 focus:ring-2 focus:ring-indigo-500"
            />
            Visible
          </label>

          {/* Opacity */}
          <div className="flex items-center gap-2">
            <label className="text-sm">Opacity</label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={rasterOpacity * 100} // multiply by 100 for slider
              onChange={(e) => {
                const val = parseFloat(e.target.value) / 100; // divide by 100 for MapLibre
                setRasterOpacity(val);
              }}
              className="flex-1 h-2 rounded-lg accent-indigo-600"
            />
            <span className="text-xs w-8 text-right">{Math.round(rasterOpacity * 100)}%</span>
          </div>
        </div>

        {/* SETTING MODE BANNER */}
        {csvMode === "SETTING" && activeCSVRow !== null && (
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-700">
            Click on the map to set a coordinate for{" "}
            <span className="font-semibold">
              row {activeCSVRow + 1}
            </span>
          </div>
        )}

        {/* CSV ROW CARDS */}
        <div className="space-y-3 overflow-y-auto h-[50vh]">
          {csvRows.map((row, i) => {
            const hasCoord = !!row.__coord;
            const isActive = activeCSVRow === i;
            const btn = getPointButtonState(i, hasCoord);

            return (
              <div
                key={i}
                className={`rounded-xl border p-4 transition ${
                  isActive
                    ? "border-orange-400 bg-orange-50"
                    : "bg-white"
                }`}
              >
                <div className="flex justify-between items-center gap-4">
                  {/* Row preview */}
                  <div className="text-sm space-y-1 max-w-[70%]">
                    {csvHeaders
                      .filter((h) => h !== "Coordinates")
                      .slice(0, 2)
                      .map((h) => (
                        <div
                          key={h}
                          className="truncate text-gray-700"
                        >
                          <span className="font-medium">{h}:</span>{" "}
                          {String(row[h] ?? "")}
                        </div>
                      ))}

                    {hasCoord ? (
                      <div className="text-xs text-green-600">
                        {row.__coord!.lon.toFixed(4)},{" "}
                        {row.__coord!.lat.toFixed(4)}
                      </div>
                    ) : (
                      <div className="text-xs text-red-400">
                        No coordinate set
                      </div>
                    )}
                  </div>

                  {/* Action */}
                  <button
                    disabled={btn.disabled}
                    onClick={() => {
                      setActiveCSVRow(i);
                      setCsvMode("SETTING");
                    }}
                    className={`px-3 py-1.5 rounded text-xs text-white transition ${btn.className}`}
                  >
                    {btn.label}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Save */}
        <button
          disabled={!allCoordsSet}
          onClick={handleSave}
          className={`w-full py-2 rounded text-white ${
            allCoordsSet
              ? "bg-green-600 hover:bg-green-700"
              : "bg-gray-300 cursor-not-allowed"
          }`}
        >
          Save
        </button>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {step === "GEOREF" && renderGeoRefStep()}
      {step === "CSV" && renderCSVStep()}

      {activeImageGcpIndex !== null && imageUrl && (
        <ImageGCPModal
          imageUrl={imageUrl}
          gcpIndex={activeImageGcpIndex}
          gcps={gcps}
          onSetPoint={(px, py) =>
            updateImagePoint(activeImageGcpIndex, px, py)
          }
          onClose={() => setActiveImageGcpIndex(null)}
        />
      )}
    </div>
  );
}