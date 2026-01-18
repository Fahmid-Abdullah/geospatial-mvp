"use client";

import { useEffect, useRef, useState } from "react";
import OpenSeadragon from "openseadragon";
import { GCPType } from "@/types/gcpTypes";

type Props = {
  imageUrl: string;
  gcpIndex: number;
  gcps: GCPType[];
  onSetPoint: (px: number, py: number) => void;
  onClose: () => void;
};

export default function ImageGCPModal({
  imageUrl,
  gcpIndex,
  gcps,
  onSetPoint,
  onClose,
}: Props) {
    const viewerRef = useRef<HTMLDivElement>(null);
    const osdRef = useRef<OpenSeadragon.Viewer | null>(null);
    const [armed, setArmed] = useState(false);
    const armedRef = useRef(false);

    useEffect(() => {
    if (!viewerRef.current) return;

    const viewer = OpenSeadragon({
        element: viewerRef.current,
        prefixUrl: "/openseadragon/",
        tileSources: { type: "image", url: imageUrl },
        showNavigator: false,
        showZoomControl: false,
        showHomeControl: false,
        showFullPageControl: false,
        gestureSettingsMouse: { clickToZoom: false },
    });

    osdRef.current = viewer;

    viewer.addHandler("canvas-click", (e) => {
    if (!armedRef.current) return;

    const vp = viewer.viewport.pointFromPixel(e.position);
    const img = viewer.viewport.viewportToImageCoordinates(vp);

    onSetPoint(Math.round(img.x), Math.round(img.y));

    armedRef.current = false;
    setArmed(false);
    onClose();
    });

    return () => viewer.destroy();
    }, [imageUrl]);


  /* ---- overlays ---- */
  useEffect(() => {
    const viewer = osdRef.current;
    if (!viewer) return;

    viewer.clearOverlays();

    gcps.forEach((gcp) => {
      if (gcp.px === null || gcp.py === null) return;

      const dot = document.createElement("div");
      dot.className =
        "w-3 h-3 flex items-center justify-center text-black";
      dot.innerHTML = `<i class="fa-solid fa-location-dot"></i>`;

      viewer.addOverlay({
        element: dot,
        location: viewer.viewport.imageToViewportCoordinates(gcp.px, gcp.py),
      });
    });
  }, [gcps]);

    const toggleArmed = () => {
    setArmed(prev => {
        const next = !prev;
        armedRef.current = next;
        return next;
    });
    };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-4xl p-4 space-y-3">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="font-semibold text-lg">
              Set Image GCP #{gcpIndex + 1}
            </h3>
            <p className="text-sm text-gray-600">
              {armed
                ? "Click on the image to place the point"
                : "Pan/zoom freely, then click “Set GCP”"}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={toggleArmed}
              className={`px-3 py-1 rounded text-white ${
                armed ? "bg-green-600" : "bg-gray-500 hover:bg-gray-700"
              }`}
            >
              Set GCP
            </button>

            <button
              onClick={onClose}
              className="px-3 py-1 rounded bg-red-500 text-white hover:bg-red-600"
            >
              Cancel
            </button>
          </div>
        </div>

        <div ref={viewerRef} className="w-full h-125 cursor-grab" />
      </div>
    </div>
  );
}