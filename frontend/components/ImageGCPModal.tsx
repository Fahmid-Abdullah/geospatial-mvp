"use client";

import { useEffect, useRef, useState } from "react";
import OpenSeadragon from "openseadragon";
import { GCPType } from "@/types/gcpTypes";

type Props = {
  imageUrl: string;
  gcpIndex: number;
  gcps: GCPType[];
  onSetPoint: (px: number | null, py: number | null) => void;
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

      minZoomLevel: 0.5,          // smallest zoom out (lower = zoom out more)
      maxZoomLevel: 10,           // max zoom in
      defaultZoomLevel: 1,        // starting zoom (1 = actual image size)
      visibilityRatio: 1,         // how much of the image must stay visible
    });

    osdRef.current = viewer;

    // Click handler
    viewer.addHandler("canvas-click", (e) => {
      if (!armedRef.current) return;

      const vp = viewer.viewport.pointFromPixel(e.position);
      const img = viewer.viewport.viewportToImageCoordinates(vp);

      onSetPoint(Math.round(img.x), Math.round(img.y));

      // Optional: add the dot immediately so it feels snappy
      addOverlayAt(Math.round(img.x), Math.round(img.y));
    });

    // Draw all overlays when the image is fully loaded
    viewer.addHandler("open", () => {
      gcps.forEach((gcp) => {
        if (gcp.px !== null && gcp.py !== null) {
          addOverlayAt(gcp.px, gcp.py);
        }
      });
    });

  // Helper function to add a single overlay
  const addOverlayAt = (px: number, py: number) => {
    const dot = document.createElement("div");
    dot.className = "w-3 h-3 flex items-center justify-center text-black";
    dot.innerHTML = `<i class="fa-solid fa-location-dot"></i>`;

    viewer.addOverlay({
      element: dot,
      location: viewer.viewport.imageToViewportCoordinates(px, py),
      placement: OpenSeadragon.Placement.CENTER,
    });
  };

  return () => viewer.destroy();
}, [imageUrl]);

  // Watch for GCP updates and redraw overlays
  useEffect(() => {
    const viewer = osdRef.current;
    if (!viewer) return;
    if (!viewer.world.getItemAt(0)) return; // wait for image

    viewer.clearOverlays();
    gcps.forEach((gcp) => {
      if (gcp.px !== null && gcp.py !== null) {
        const dot = document.createElement("div");
        dot.className = "w-3 h-3 flex items-center justify-start text-black";
        dot.innerHTML = `<i class="fa-solid fa-location-dot"></i>`;

        viewer.addOverlay({
          element: dot,
          location: viewer.viewport.imageToViewportCoordinates(gcp.px, gcp.py),
          placement: OpenSeadragon.Placement.CENTER,
        });
      }
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
              Enable GCP Placement
            </button>

            <button
              onClick={onClose}
              className="px-3 py-1 rounded bg-red-500 text-white hover:bg-red-600"
            >
              Close
            </button>
          </div>
        </div>

        <div ref={viewerRef} className={`w-full h-125 ${armed ? "cursor-crosshair" : "cursor-grab"}`} />
      </div>
    </div>
  );
}