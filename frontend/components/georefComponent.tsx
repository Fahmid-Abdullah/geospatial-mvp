"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { MapContext } from "@/context/MapContext";
import { EMPTY_GCPS } from "@/app/dashboard/page";
import { GCPType } from "@/types/gcpTypes";
import { toast } from "react-toastify";

const GeoRefComponent = () => {
  const mContext = useContext(MapContext);
  if (!mContext) return null;

  const [loading, setLoading] = useState<boolean>(false);
  const [projectId, setProjectId] = mContext.selectedProjectState;
  const [imageUrl, _setImageUrl] = mContext.imageUrlState;
  const [imagePath, _setImagePath] = mContext.imagePathState;
  const [gcps, setGcps] = mContext.gcpPathState;
  const [selectedGcp, setSelectedGcp] = mContext.selectedGcpPathState;
  const [_isGeoreferencing, setIsGeoreferencing] = mContext.isGeoreferencingState;
  const [_rasterUrl, setRasterUrl] = mContext.rasterUrlState;
  const [showImgModal, setShowImgModal] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const mainImgRef = useRef<HTMLImageElement | null>(null);
  const modalImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (imageUrl) {
      setShowImgModal(true);
      setGcps(EMPTY_GCPS);
      setActiveIndex(0);
    }
  }, [imageUrl]);


  const handleImageClick = (e: React.MouseEvent) => {
    if (activeIndex >= 4 || !modalImgRef.current) return;

    const rect = modalImgRef.current.getBoundingClientRect();
    const px = Math.round(((e.clientX - rect.left) / rect.width) * modalImgRef.current.naturalWidth);
    const py = Math.round(((e.clientY - rect.top) / rect.height) * modalImgRef.current.naturalHeight);

    setGcps(prev => {
      const next = [...prev];
      next[activeIndex] = { ...next[activeIndex], px, py };
      return next;
    });

    setActiveIndex(i => Math.min(i + 1, 4));
    if (activeIndex + 1 >= 4) setShowImgModal(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!modalImgRef.current) return;

    const rect = modalImgRef.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * modalImgRef.current.naturalWidth);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * modalImgRef.current.naturalHeight);
    setMousePos({ x, y });
  };

  const remaining = 4 - gcps.filter(g => g.px !== null && g.py !== null).length;
  const canGeoreference = gcps.every(g => g.px !== null && g.py !== null && g.lon !== null && g.lat !== null);

  const resetImageGcps = () => {
    setGcps(EMPTY_GCPS);
    setActiveIndex(0);
    setShowImgModal(true);
    setSelectedGcp(null);
  };

  const renderDots = (imgRef: React.RefObject<HTMLImageElement | null>) => {
    if (!imgRef.current) return null;
    const wScale = imgRef.current.clientWidth / imgRef.current.naturalWidth;
    const hScale = imgRef.current.clientHeight / imgRef.current.naturalHeight;

    return gcps.map(
      g =>
        g.px !== null &&
        g.py !== null && (
          <div
            key={g.id}
            className="absolute w-3 h-3 bg-red-600 rounded-full text-[10px] text-white flex items-center justify-center pointer-events-none"
            style={{
              left: g.px * wScale - 6,
              top: g.py * hScale - 6,
            }}
          >
            {g.id}
          </div>
        )
    );
  };

  const setSelected = (gcp: GCPType) => {
    if (gcp.px === null) {
      toast.error("Please set Image GCPs first.");
      return;
    }

    if (gcp === selectedGcp) {
      setSelectedGcp(null);
    } else {
      setSelectedGcp(gcp);
    }
  }

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

      if (!res.ok || !data.signedUrl) {
        toast.error("Failed to georeference image");
        return;
      }

      // Flask already uploaded + signed it
      setRasterUrl(data.signedUrl);
      toast.success("Image georeferenced successfully!");
      setIsGeoreferencing(false);
    } catch (err) {
      console.error(err);
      toast.error("Error during georeferencing");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full px-4 py-8">
      <h2 className="text-lg font-semibold mb-4">Georeference Image</h2>

      {imageUrl && (
        <div className="relative w-fit mb-4">
          <img ref={mainImgRef} src={imageUrl} className="max-w-full rounded border select-none" />
          {renderDots(mainImgRef)}
          <button
            onClick={resetImageGcps}
            className="absolute bottom-2 right-2 bg-black/70 text-white px-3 py-1 rounded text-sm cursor-pointer"
          >
            Reset / Place Image GCPs
          </button>
        </div>
      )}

      {/* -------- GCP List -------- */}
      <div className="mt-6 space-y-2">
        {gcps.map((gcp) => (
          <div key={gcp.id} className="flex items-center justify-between border rounded px-3 py-2">
            <div className="text-sm">
              <strong>Point {gcp.id}:</strong>
              <div>
                {gcp.px !== null && gcp.py !== null
                  ? `px ${gcp.px}, py ${gcp.py}`
                  : "px/py not set"}
              </div>
              <div>
                {gcp.lon !== null && gcp.lat !== null
                  ? `lon ${gcp.lon.toFixed(2)}, lat ${gcp.lat.toFixed(2)}`
                  : "lon/lat not set"}
              </div>
            </div>
            <button
              className="text-xs px-2 py-1 rounded text-white bg-gray-400 hover:bg-gray-600 transition-transform duration-200 ease-in-out cursor-pointer"
              onClick={() => setSelected(gcp)}
            >
              {selectedGcp?.id === gcp.id ? "Setting..." : "Set Map Point"}
            </button>
          </div>
        ))}
      </div>

      {/* -------- Georeference -------- */}
      <button
        disabled={!canGeoreference}
        onClick={handleGeoreference}
        className={`mt-6 w-full py-2 rounded text-white ${
          canGeoreference
            ? "bg-gray-400 hover:bg-gray-600 transition-transform duration-200 ease-in-out cursor-pointer"
            : "bg-gray-200 cursor-not-allowed"
        }
          ${loading && "disabled"}`}
      >
        {loading ? "Georeferencing..." : "Georeference"}
      </button>
      {!canGeoreference && <p className="text-red-500 text-xs text-center mt-1">Please set Image & Map GCP Points to Georeference</p>}

      {/* ================= IMAGE MODAL ================= */}
      {showImgModal && imageUrl && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg p-4 relative max-w-3xl w-full">
            <button onClick={() => setShowImgModal(false)} className="absolute top-3 right-3 text-gray-600 cursor-pointer">
              <i className="fa-solid fa-xmark" />
            </button>

            <h3 className="text-lg font-semibold mb-2">Place 4 markers</h3>
            <p className="text-sm text-gray-600 mb-2">{remaining > 0 ? `${remaining} points remaining` : "All image points placed"}</p>

            <div className="relative">
              <img
                ref={modalImgRef}
                src={imageUrl}
                onClick={handleImageClick}
                onMouseMove={handleMouseMove}
                className="max-w-full cursor-crosshair select-none"
              />
              {renderDots(modalImgRef)}
            </div>

            {mousePos && (
              <div className="mt-2 text-xs text-gray-700">
                px: {mousePos.x}, py: {mousePos.y}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GeoRefComponent;