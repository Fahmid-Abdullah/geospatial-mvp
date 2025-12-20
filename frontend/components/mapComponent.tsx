"use client";

import { useContext, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { MapContext } from "@/context/MapContext";
import MapboxDraw from "maplibre-gl-draw";
import { FeatureLayerType, FeatureType } from "@/types/tableTypes";

import type {
  FeatureCollection,
  Geometry,
  GeoJsonProperties,
  Feature,
} from "geojson";

// Convert FeatureLayerType to GeoJSON FeatureCollection
const toFeatureCollection = (fl: FeatureLayerType): FeatureCollection<Geometry, GeoJsonProperties> => ({
  type: "FeatureCollection",
  features: fl.features
    .filter(f => f.is_visible)
    .map(
      (f): Feature<Geometry, GeoJsonProperties> => ({
        type: "Feature",
        id: f.id, // optional, may not survive in vector tiles
        geometry: f.geom,
        properties: {
          ...f.properties,
          __feature_id: f.id, // <-- store your original id here
          __layer_id: fl.layer.id
        },
      })
    ),
});

// Determine render type
const getRenderType = (fc: FeatureCollection): "point" | "line" | "polygon" | null => {
  for (const f of fc.features) {
    const t = f.geometry?.type;
    if (!t) continue;

    if (t === "Point" || t === "MultiPoint") return "point";
    if (t === "LineString" || t === "MultiLineString") return "line";
    if (t === "Polygon" || t === "MultiPolygon") return "polygon";
  }
  return null;
};

interface MapComponentProps {
  drawMode: boolean;
}

const MapComponent = ({ drawMode }: MapComponentProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const fitBoundsRef = useRef<() => void>(() => {});
  const mapContext = useContext(MapContext);

  if (!mapContext) return null;

  const [zoom, setZoom] = mapContext.zoomState;
  const [coords, setCoords] = mapContext.coordsState;
  const [activeMode, setActiveMode] = useState<string | null>(null);

  const [featureLayers] = mapContext.featurelayerState;

  const [selectedFeature, setSelectedFeature] = mapContext.selectedFeatureState;
  const [selectedLayer, setSelectedLayer] = mapContext.selectedLayerState;

  const [selectedGcp, setSelectedGcp] = mapContext.selectedGcpPathState;
  const [gcps, setGcps] = mapContext.gcpPathState;
  const [rasterUrl, _setRasterUrl] = mapContext.rasterUrlState;
  const [isGeoreferencing, _setIsGeoreferencing] = mapContext.isGeoreferencingState;

  // --- Initialize Map ---
  useEffect(() => {
    if (!mapContainerRef.current || mapContext.mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          "osm-tiles": {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm-layer", type: "raster", source: "osm-tiles" }],
      },
      center: [-81.27, 43.0],
      zoom: 12,
    });

    mapContext.mapRef.current = map;

    const onZoomEnd = () => setZoom(map.getZoom());
    map.on("zoomend", onZoomEnd);

    let lastTime = 0;
    const onMouseMove = (e: { lngLat: { lng: number; lat: number } }) => {
      const now = Date.now();
      if (now - lastTime < 200) return;
      lastTime = now;
      setCoords(e.lngLat);
    };
    map.on("mousemove", onMouseMove);

    return () => {
      map.off("zoomend", onZoomEnd);
      map.off("mousemove", onMouseMove);
      map.remove();
      mapContext.mapRef.current = null;
    };
  }, []);

  // --- Initialize Draw ---
  useEffect(() => {
    if (!mapContext || mapContext.drawRef.current) return;

    const draw = new MapboxDraw({ displayControlsDefault: false });
    mapContext.drawRef.current = draw;
  }, [mapContext]);

  // --- Attach Draw to Map ---
  useEffect(() => {
    const map = mapContext.mapRef.current;
    const draw = mapContext.drawRef.current;
    if (!map || !draw) return;

    if (!map.hasControl(draw as any)) map.addControl(draw as any);

    const onModeChange = (e: any) => setActiveMode(e.mode);
    map.on("draw.modechange", onModeChange);

    return () => {
      map.off("draw.modechange", onModeChange);
    };
  }, [mapContext]);

  // --- Fit On Bounds ---
  fitBoundsRef.current = () => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    const selectedFl = selectedLayer 
      ? featureLayers.find(fl => fl.layer.id === selectedLayer.id) 
      : null;

    const featuresToFit = selectedFl
      ? selectedFl.features.filter(f => f.is_visible)
      : featureLayers.flatMap(fl => fl.features.filter(f => f.is_visible));

    if (featuresToFit.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();

    const extendCoords = (geom: Geometry) => {
      if (!geom) return;
      switch (geom.type) {
        case "Point":
        case "MultiPoint":
        case "LineString":
        case "MultiLineString":
        case "Polygon":
        case "MultiPolygon":
          const coords = geom.coordinates as any;
          const addCoords = (c: any) =>
            Array.isArray(c[0]) ? c.forEach(addCoords) : bounds.extend(c as [number, number]);
          addCoords(coords);
          break;
        case "GeometryCollection":
          geom.geometries.forEach(g => extendCoords(g));
          break;
      }
    };

    featuresToFit.forEach(f => extendCoords(f.geom));

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: { top: 50, bottom: 50, left: 600, right: 500 },
        maxZoom: 10,
        duration: 800,
      });
    }
  };

  useEffect(() => {
    fitBoundsRef.current();
  }, [selectedLayer]);

  // --- Render & Update Feature Layers ---
  useEffect(() => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    const updateLayers = () => {
      const currentLayerIds = new Set(
        featureLayers.flatMap(fl => [
          `layer-${fl.layer.id}`,
          `layer-${fl.layer.id}-outline`,
        ])
      );

      // Remove obsolete layers and sources
      map.getStyle().layers?.forEach(l => {
        if (l.id.startsWith("layer-") && !currentLayerIds.has(l.id)) {
          if (map.getLayer(l.id)) map.removeLayer(l.id);
          const sourceId = `source-${l.id.replace("layer-", "")}`;
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        }
      });

      // Add or update layers
      featureLayers.forEach(fl => {
        const sourceId = `source-${fl.layer.id}`;
        const layerId = `layer-${fl.layer.id}`;
        const geojson = toFeatureCollection(fl);
        const renderType = getRenderType(geojson);
        if (!renderType) return;

        // Update or add source
        if (map.getSource(sourceId)) {
          (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(geojson);
        } else {
          map.addSource(sourceId, { type: "geojson", data: geojson });
        }

        if (!map.getLayer(layerId)) {
          if (renderType === "point") {
            map.addLayer({
              id: layerId,
              type: "circle",
              source: sourceId,
              paint: {
                "circle-radius": fl.layer.style_size ?? 5,
                "circle-color": fl.layer.style_color ?? "#3b82f6",
                "circle-opacity": fl.layer.style_opacity ?? 1,
              },
            });
          } else if (renderType === "polygon") {
            const fillColor = fl.layer.style_color ?? "#22c55e";

            if (!map.getLayer(layerId)) {
              // Add fill
              map.addLayer({
                id: layerId,
                type: "fill",
                source: sourceId,
                paint: {
                  "fill-color": fillColor,
                  "fill-opacity": fl.layer.style_opacity ?? 0.4,
                },
              });
            } else {
              // Update fill
              map.setPaintProperty(layerId, "fill-color", fillColor);
              map.setPaintProperty(layerId, "fill-opacity", fl.layer.style_opacity ?? 0.4);
            }

            const outlineId = `${layerId}-outline`;

            if (!map.getLayer(outlineId)) {
              // Add outline if missing
              map.addLayer(
                {
                  id: outlineId,
                  type: "line",
                  source: sourceId,
                  paint: {
                    "line-color": darkenColor(fillColor, 0.3),
                    "line-width": 2,
                  },
                },
                layerId
              );
            } else {
              // Update outline color
              map.setPaintProperty(outlineId, "line-color", darkenColor(fillColor, 0.3));
            }
          }

          // Helper to darken color
          function darkenColor(hex: string, amount: number) {
            const c = hex.replace("#", "");
            const num = parseInt(c, 16);
            const r = Math.max(0, ((num >> 16) & 0xff) * (1 - amount));
            const g = Math.max(0, ((num >> 8) & 0xff) * (1 - amount));
            const b = Math.max(0, (num & 0xff) * (1 - amount));
            return `rgb(${r},${g},${b})`;
          }
        } else {
          // Update paint properties
          if (renderType === "point") {
            map.setPaintProperty(layerId, "circle-radius", fl.layer.style_size);
            map.setPaintProperty(layerId, "circle-color", fl.layer.style_color);
            map.setPaintProperty(layerId, "circle-opacity", fl.layer.style_opacity);
          } else if (renderType === "line") {
            map.setPaintProperty(layerId, "line-width", fl.layer.style_size);
            map.setPaintProperty(layerId, "line-color", fl.layer.style_color);
            map.setPaintProperty(layerId, "line-opacity", fl.layer.style_opacity);
          } else if (renderType === "polygon") {
            map.setPaintProperty(layerId, "fill-color", fl.layer.style_color);
            map.setPaintProperty(layerId, "fill-opacity", fl.layer.style_opacity);

            const outlineId = `${layerId}-outline`;
            if (map.getLayer(outlineId)) {
              map.setPaintProperty(outlineId, "line-color", fl.layer.style_color);
            }
          }
        }
      });



      featureLayers.forEach(fl => {
        const layerId = `layer-${fl.layer.id}`;
        const outlineId = `${layerId}-outline`;

        // Move fill layer to the correct order
        if (map.getLayer(layerId)) map.moveLayer(layerId);

        // Move outline above its fill
        if (map.getLayer(outlineId)) map.moveLayer(outlineId, layerId);
      });

      // Move highlight layers to the top
      ['highlight-layer', 'highlight-layer-outline', 'highlight-layer-point', 'highlight-layer-line'].forEach(id => {
        if (map.getLayer(id)) map.moveLayer(id);
      });
    };

    if (!map.isStyleLoaded()) {
      map.once("load", () => {
        updateLayers();
        fitBoundsRef.current();
      });
    } else {
      updateLayers();
      fitBoundsRef.current();
    }
  }, [featureLayers]);

  // --- Feature Click ---
  useEffect(() => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: featureLayers.map(fl => `layer-${fl.layer.id}`),
      });

      if (features.length) {
        const topFeature = features[0];
        const featureId = topFeature.properties.__feature_id;
        const layerId = topFeature.properties.__layer_id;
        const clickedLayer = featureLayers.find(fl => fl.layer.id === layerId);

        if (clickedLayer) {
          setSelectedLayer(clickedLayer.layer);

          const clickedFeature = clickedLayer.features.find(f => f.id === featureId);
          if (clickedFeature) setSelectedFeature(clickedFeature);
        }

      }
    };

    map.on("click", handleMapClick);

    return () => {
      map.off("click", handleMapClick);
    };
  }, [featureLayers]);

  // --- Highlight Selected Feature Layer ---
  useEffect(() => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    const setupHighlight = () => {
      const highlightSourceId = "highlight-source";
      const highlightLayerId = "highlight-layer";

      // Helper: convert your FeatureType to proper GeoJSON
      const toGeoJSONFeature = (f: FeatureType): Feature<Geometry, GeoJsonProperties> => ({
        type: "Feature",
        geometry: f.geom,
        properties: f.properties ?? {},
        id: f.id,
      });

      // Ensure the highlight source exists
      if (!map.getSource(highlightSourceId)) {
        map.addSource(highlightSourceId, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        // Polygon fill
        map.addLayer({
          id: highlightLayerId,
          type: "fill",
          source: highlightSourceId,
          paint: { "fill-color": "#facc15", "fill-opacity": 0.8 },
        });

        // Polygon outline
        map.addLayer({
          id: `${highlightLayerId}-outline`,
          type: "line",
          source: highlightSourceId,
          paint: { "line-color": "#b45309", "line-width": 2 },
        });

        // Circle for points
        map.addLayer({
          id: `${highlightLayerId}-point`,
          type: "circle",
          source: highlightSourceId,
          paint: { "circle-radius": 8, "circle-color": "#facc15", "circle-opacity": 1 },
        });

        // Line for lines
        map.addLayer({
          id: `${highlightLayerId}-line`,
          type: "line",
          source: highlightSourceId,
          paint: { "line-color": "#facc15", "line-width": 4, "line-opacity": 1 },
        });
      }

      // Update highlight data
      if (selectedFeature && selectedLayer) {
        const geoFeature = toGeoJSONFeature(selectedFeature);

        (map.getSource(highlightSourceId) as maplibregl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: [geoFeature],
        });

        const geomType = selectedFeature.geom?.type;

        map.setLayoutProperty(`${highlightLayerId}-point`, "visibility", geomType?.includes("Point") ? "visible" : "none");
        map.setLayoutProperty(`${highlightLayerId}-line`, "visibility", geomType?.includes("LineString") ? "visible" : "none");
        map.setLayoutProperty(highlightLayerId, "visibility", geomType?.includes("Polygon") ? "visible" : "none");
        map.setLayoutProperty(`${highlightLayerId}-outline`, "visibility", geomType?.includes("Polygon") ? "visible" : "none");

        if (geomType?.includes("Point")) {
          map.setPaintProperty(`${highlightLayerId}-point`, "circle-radius", selectedLayer.style_size ?? 8);
        } else if (geomType?.includes("LineString")) {
          map.setPaintProperty(`${highlightLayerId}-line`, "line-width", selectedLayer.style_size ?? 4);
        }
      } else {
        // Hide all highlight layers when nothing is selected
        map.setLayoutProperty(`${highlightLayerId}-point`, "visibility", "none");
        map.setLayoutProperty(`${highlightLayerId}-line`, "visibility", "none");
        map.setLayoutProperty(highlightLayerId, "visibility", "none");
        map.setLayoutProperty(`${highlightLayerId}-outline`, "visibility", "none");
      }
    };

    // Wait for style to be fully loaded
    if (!map.isStyleLoaded()) {
      map.once("load", setupHighlight);
    } else {
      setupHighlight();
    }
  }, [selectedFeature, selectedLayer]);

  // --- Handle Map Click for Georeferencing ---
  useEffect(() => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    const handleGcpMapClick = (e: maplibregl.MapMouseEvent) => {
      if (!isGeoreferencing || selectedGcp === null) return;

      const gcpIndex = gcps.findIndex(g => g.id === selectedGcp.id);
      if (gcpIndex === -1) return;

      const gcp = gcps[gcpIndex];
      if (gcp.px === null || gcp.py === null) return; // only set if image px/py exist

      const { lng, lat } = e.lngLat;

      const newGcps = [...gcps];
      newGcps[gcpIndex] = { ...gcp, lon: lng, lat: lat };
      setGcps(newGcps);

      // Clear selectedGcp so user can select the next one
      setSelectedGcp(null);
    };

    map.on("click", handleGcpMapClick);

    return () => {
      map.off("click", handleGcpMapClick);
    };
  }, [isGeoreferencing, selectedGcp, gcps]);

  // --- Handle Raster Image Safely ---
  useEffect(() => {
    const map = mapContext.mapRef.current;
    if (!map || !rasterUrl) return;

    const sourceId = "georef-raster";
    const layerId = "georef-layer";

    const addRaster = () => {
      try {
        // Remove existing raster layer/source if present
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);

        // Add raster source
        map.addSource(sourceId, {
          type: "raster",
          tiles: [rasterUrl],
          tileSize: 256,
        });

        // Add raster layer
        map.addLayer({
          id: layerId,
          type: "raster",
          source: sourceId,
        });
      } catch (err) {
        console.error("Failed to add raster layer:", err);

        // Fallback: show a default OSM tile instead of crashing
        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
          });
        }
        if (!map.getLayer(layerId)) {
          map.addLayer({
            id: layerId,
            type: "raster",
            source: sourceId,
          });
        }
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("load", addRaster);
    } else {
      addRaster();
    }
  }, [rasterUrl]);

  // --- Draw Handlers ---
  const handleDrawPoint = () => mapContext.drawRef.current?.changeMode("draw_point");
  const handleDrawLine = () => mapContext.drawRef.current?.changeMode("draw_line_string");
  const handleDrawPolygon = () => mapContext.drawRef.current?.changeMode("draw_polygon");
  const handleTrash = () => {
    mapContext.drawRef.current?.getSelectedIds().forEach(id => mapContext.drawRef.current?.delete(id));
  };

  const buttonClass = (mode: string, baseColor: string) =>
    `px-3 py-1 rounded text-white ${activeMode === mode ? "brightness-125" : "hover:brightness-110"} ${baseColor}`;

  return (
    <div className="h-full relative">
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Zoom & Coords */}
      <div className="absolute bottom-0 left-2/5 -translate-x-1/2 bg-white/80 px-4 py-2 rounded-t-xl flex gap-4 text-black text-sm font-medium shadow-md">
        <p><strong>Zoom:</strong> {zoom.toFixed(0)}</p>
        <p><strong>Coords:</strong> {coords.lng.toFixed(2)}, {coords.lat.toFixed(2)}</p>
      </div>

      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 bg-white/80 px-4 py-2 rounded-t-xl flex gap-4 text-black text-sm font-medium shadow-md">
          <button className="bg-gray-400 cursor-pointer px-2 py-1 text-white"
            onClick={() => {
              setSelectedLayer(null);
              fitBoundsRef.current();
            }}>
            <i className="fa-solid fa-expand"></i>
          </button>
      </div>

      {/* Draw Buttons */}
      {drawMode && (
        <div className="absolute bottom-0 left-3/5 -translate-x-1/2 bg-white/80 px-4 py-2 rounded-t-xl flex gap-2 shadow-md">
          <button className={buttonClass("draw_point", "bg-gray-400")} onClick={handleDrawPoint}>
            <i className="fa-solid fa-location-dot"></i>
          </button>
          <button className={buttonClass("draw_line_string", "bg-gray-400")} onClick={handleDrawLine}>
            <i className="fa-solid fa-arrow-trend-up"></i>
          </button>
          <button className={buttonClass("draw_polygon", "bg-gray-400")} onClick={handleDrawPolygon}>
            <i className="fa-solid fa-draw-polygon"></i>
          </button>
          <button
            className="bg-gray-400 text-white px-4 py-2 rounded-md hover:bg-red-500 hover:scale-105 transition-transform duration-200 cursor-pointer"
            onClick={handleTrash}
          >
            <i className="fa-solid fa-trash-can"></i>
          </button>
        </div>
      )}
    </div>
  );
};

export default MapComponent;