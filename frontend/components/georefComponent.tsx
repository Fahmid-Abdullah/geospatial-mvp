"use client";

import { useContext, useEffect, useState } from "react";
import { MapContext } from "@/context/MapContext";
import { EMPTY_GCPS } from "@/app/dashboard/page";
import { toast } from "react-toastify";
import ImageGCPModal from "./ImageGCPModal";

const GeoRefComponent = () => {
  const ctx = useContext(MapContext);
  if (!ctx) return null;

  const [projectId] = ctx.selectedProjectState;
  const [imageUrl] = ctx.imageUrlState;
  const [gcps, setGcps] = ctx.gcpPathState;
  const [selectedGcp, setSelectedGcp] = ctx.selectedGcpPathState;
  const [, setIsGeoreferencing] = ctx.isGeoreferencingState;
  const [, setRasterUrl] = ctx.rasterUrlState;

  const [activeImageGcp, setActiveImageGcp] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (imageUrl) setGcps(EMPTY_GCPS);
  }, [imageUrl]);

  const canGeoreference = gcps.every(
    (g) =>
      g.px !== null &&
      g.py !== null &&
      g.lon !== null &&
      g.lat !== null
  );

  const setImagePoint = (index: number, px: number, py: number) => {
    setGcps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], px, py };
      return next;
    });
  };

  const handleGeoreference = async () => {
    if (!canGeoreference || !imageUrl || !projectId) return;

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
      if (!res.ok || !data.signedUrl) throw new Error();

      setRasterUrl(data.signedUrl);
      toast.success("Image georeferenced!");
      setIsGeoreferencing(false);
    } catch {
      toast.error("Georeferencing failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-lg font-semibold">Georeference Image</h2>

      {/* -------- GCP LIST -------- */}
      <div className="space-y-3">
        {gcps.map((gcp, i) => (
          <div
            key={gcp.id}
            className="border rounded-lg p-4 flex justify-between items-center"
          >
            <div>
              <h4 className="font-medium">Point {i + 1}</h4>
              <div className="text-sm text-gray-600">
                Image: {gcp.px !== null ? "✓" : "—"} | Map:{" "}
                {gcp.lon !== null ? "✓" : "—"}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setActiveImageGcp(i)}
                className="px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600"
              >
                Set Image GCP
              </button>

              <button
                onClick={() => setSelectedGcp(gcp)}
                className="px-3 py-1 rounded bg-gray-500 text-white hover:bg-gray-700"
              >
                Set Map Point
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* -------- FINAL ACTION -------- */}
      <button
        disabled={!canGeoreference}
        onClick={handleGeoreference}
        className={`w-full py-2 rounded text-white ${
          canGeoreference
            ? "bg-green-600 hover:bg-green-700"
            : "bg-gray-300 cursor-not-allowed"
        }`}
      >
        {loading ? "Processing…" : "Georeference"}
      </button>

      {/* -------- IMAGE MODAL -------- */}
      {activeImageGcp !== null && imageUrl && (
        <ImageGCPModal
          imageUrl={imageUrl}
          gcpIndex={activeImageGcp}
          gcps={gcps}
          onSetPoint={(px: number, py: number) => setImagePoint(activeImageGcp, px, py)}
          onClose={() => setActiveImageGcp(null)}
        />
      )}
    </div>
  );
};

export default GeoRefComponent;