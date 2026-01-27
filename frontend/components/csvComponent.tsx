"use client";

import { useContext, useEffect, useState } from "react";
import maplibregl from "maplibre-gl";
import { MapContext } from "@/context/MapContext";
import { toast } from "react-toastify";

type CSVProps = {
  cancelCsv: () => void;
};

const CsvComponent = ({ cancelCsv }: CSVProps) => {
  const ctx = useContext(MapContext);
  if (!ctx) return null;

  const [projectId] = ctx.selectedProjectState;
  const [csvRows, setCsvRows] = ctx.csvRows;

  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvMode, setCsvMode] = useState<"SETTING" | "REVIEW">("REVIEW");
  const [activeCSVRow, setActiveCSVRow] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  /* ---------------- CSV upload ---------------- */

  const uploadCSV = async (file: File) => {
    try {
      setLoading(true);

      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/csv/preview", {
        method: "POST",
        body: form,
      });

      const data = await res.json();
      if (!res.ok) throw new Error();

      setCsvHeaders([...data.headers, "Coordinates"]);
      setCsvRows(data.previewRows.map((r: any) => ({ ...r })));
      setCsvMode("REVIEW");
      setActiveCSVRow(null);
    } catch {
      toast.error("Failed to upload CSV");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- map click attach ---------------- */

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
  }, [csvMode, activeCSVRow, ctx.mapRef, setCsvRows]);

  /* ---------------- helpers ---------------- */

  const csvEscape = (value: any) => {
    const s = String(value ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const buildCSVText = () => {
    const LAT_COL = "__lat";
    const LON_COL = "__lon";

    const headers = [
      ...csvHeaders.filter((h) => h !== "Coordinates"),
      LAT_COL,
      LON_COL,
    ];

    const lines = [
      headers.join(","),
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

  /* ---------------- save ---------------- */

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

      if (!res.ok) throw new Error();

      toast.success("CSV points added!");

      setCsvRows([]);
      setActiveCSVRow(null);
      cancelCsv();
    } catch {
      toast.error("Failed to process CSV");
    } finally {
      setLoading(false);
    }
  };

  const allCoordsSet = csvRows.every((r) => r.__coord);

  /* ---------------- render ---------------- */

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-lg font-semibold">Upload CSV & Attach Coordinates</h2>

      {/* Upload */}
      <label className="flex flex-col items-center gap-2 border rounded-xl px-5 py-4 cursor-pointer hover:bg-gray-50">
        <i className="fa-solid fa-file-csv text-xl text-green-600" />
        <span className="text-sm">
          {loading ? "Uploading…" : "Click to upload CSV"}
        </span>
        <input
          type="file"
          accept=".csv"
          disabled={loading}
          onChange={(e) => e.target.files && uploadCSV(e.target.files[0])}
          className="hidden"
        />
      </label>

      {/* Setting banner */}
      {csvMode === "SETTING" && activeCSVRow !== null && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm">
          Click the map to set a coordinate for row{" "}
          <strong>{activeCSVRow + 1}</strong>
        </div>
      )}

        {/* Rows */}
        <div className="space-y-3 max-h-[50vh] overflow-y-auto">
            {csvRows.map((row, i) => {
                const hasCoord = !!row.__coord;
                const isActive = activeCSVRow === i;

                return (
                <div
                    key={i}
                    className={`relative rounded-xl border p-4 transition ${
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
                        <div className="flex gap-2">
                            Coordinates: 
                            <p className="text-green-600">
                                {row.__coord!.lon.toFixed(4)},{" "}
                                {row.__coord!.lat.toFixed(4)}
                            </p>
                        </div>
                        ) : (
                        <div className="text-xs text-red-400">
                            No coordinate set
                        </div>
                        )}
                    </div>

                    {/* Action */}
                    <button
                        onClick={() => {
                        setActiveCSVRow(i);
                        setCsvMode("SETTING");
                        }}
                        className={`absolute top-4 right-6 rounded px-4 py-2 text-xs text-white transition ${
                        hasCoord
                            ? "bg-yellow-500 hover:bg-yellow-600"
                            : "bg-blue-600 hover:bg-blue-700"
                        }`}
                    >
                        {hasCoord ? "Edit point" : "Set point"}
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

export default CsvComponent;