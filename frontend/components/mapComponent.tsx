"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { MapContext } from "@/context/MapContext";
import MapboxDraw from "maplibre-gl-draw";
import { FeatureLayerType, FeatureType } from "@/types/tableTypes";

import { CreateFeature } from "@/actions/featureActions";
import { CreateLayer, GetProjectLayerFeatures } from "@/actions/layerActions";
import { DeleteFeature } from "@/actions/featureActions";

import type {
  FeatureCollection,
  Geometry,
  GeoJsonProperties,
  Feature,
} from "geojson";

// Convert FeatureLayerType to GeoJSON FeatureCollection
const toFeatureCollection = (
  fl: FeatureLayerType
): FeatureCollection<Geometry, GeoJsonProperties> => ({
  type: "FeatureCollection",
  features: fl.features
    .filter((f) => f.is_visible)
    .map(
      (f): Feature<Geometry, GeoJsonProperties> => ({
        type: "Feature",
        id: f.id,
        geometry: f.geom,
        properties: {
          ...(f.properties ?? {}),
          __feature_id: f.id,
          __layer_id: fl.layer.id,
        },
      })
    ),
});

// Determine render type
const getRenderType = (
  fc: FeatureCollection
): "point" | "line" | "polygon" | null => {
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

type PendingDraw = {
  drawId: string;
  feature: Feature<Geometry, GeoJsonProperties>;
};

const MapComponent = ({ drawMode }: MapComponentProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const fitBoundsRef = useRef<() => void>(() => {});
  const mapContext = useContext(MapContext);

  if (!mapContext) return null;

  const [zoom, setZoom] = mapContext.zoomState;
  const [coords, setCoords] = mapContext.coordsState;
  const [activeMode, setActiveMode] = useState<string | null>(null);

  const [featureLayers, setFeatureLayers] = mapContext.featurelayerState;

  const [selectedProject] = mapContext.selectedProjectState;

  const [selectedFeature, setSelectedFeature] = mapContext.selectedFeatureState;
  const [selectedLayer, setSelectedLayer] = mapContext.selectedLayerState;

  const [selectedGcp, setSelectedGcp] = mapContext.selectedGcpPathState;
  const [gcps, setGcps] = mapContext.gcpPathState;
  const [rasterUrl, _setRasterUrl] = mapContext.rasterUrlState;
  const [isGeoreferencing, _setIsGeoreferencing] =
    mapContext.isGeoreferencingState;

  // -----------------------------
  // Modal + pending draw state
  // -----------------------------
  const [pendingDraw, setPendingDraw] = useState<PendingDraw | null>(null);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);

  const [assignMode, setAssignMode] = useState<"existing" | "new">("existing");
  const [existingLayerId, setExistingLayerId] = useState<string>("");
  const [newLayerName, setNewLayerName] = useState<string>("");

  // Existing layer props: only shared keys
  const [existingPropsDraft, setExistingPropsDraft] = useState<
    Record<string, string>
  >({});

  // New layer props: arbitrary rows
  const [newPropsRows, setNewPropsRows] = useState<
    Array<{ key: string; value: string }>
  >([{ key: "", value: "" }]);

  // shared keys helper
  const getSharedPropertyKeysForLayer = (layerId: string): string[] => {
    const fl = featureLayers.find((x) => x.layer.id === layerId);
    if (!fl) return [];

    const feats = fl.features;
    if (!feats.length) return [];

    const keysOf = (p: any) =>
      p && typeof p === "object" ? Object.keys(p) : [];

    let shared = new Set<string>(keysOf(feats[0].properties));

    for (let i = 1; i < feats.length; i++) {
      const kset = new Set<string>(keysOf(feats[i].properties));
      shared = new Set([...shared].filter((k) => kset.has(k)));
    }

    const cleaned = [...shared].filter((k) => !k.startsWith("__"));
    cleaned.sort((a, b) => a.localeCompare(b));
    return cleaned;
  };

  const sharedKeys = useMemo(() => {
    if (!existingLayerId) return [];
    return getSharedPropertyKeysForLayer(existingLayerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingLayerId, featureLayers]);

  const resetAssignModalState = () => {
    const first = featureLayers[0]?.layer.id ?? "";
    setAssignMode(first ? "existing" : "new");
    setExistingLayerId(first);
    setNewLayerName("");
    setExistingPropsDraft({});
    setNewPropsRows([{ key: "", value: "" }]);
  };

  const closeAssignModal = () => {
    setIsAssignModalOpen(false);
    setPendingDraw(null);
    resetAssignModalState();
  };

  const deletePendingDrawFromDrawControl = () => {
    const draw = mapContext.drawRef.current;
    if (!draw || !pendingDraw) return;
    try {
      draw.delete(pendingDraw.drawId);
    } catch {
      // ignore
    }
  };

  const cleanProps = (obj: Record<string, string>) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      const key = (k ?? "").trim();
      if (!key) continue;
      out[key] = (v ?? "").trim(); // allow empty values
    }
    return out;
  };

  const cleanRowsToProps = (rows: Array<{ key: string; value: string }>) => {
    const out: Record<string, string> = {};
    for (const r of rows) {
      const k = (r.key ?? "").trim();
      if (!k) continue;
      out[k] = (r.value ?? "").trim();
    }
    return out;
  };

  const handleSaveFeature = async () => {
    if (!pendingDraw) return;

    const geom = pendingDraw.feature.geometry;
    if (!geom) return;

    const projectId = selectedProject?.id;
    if (!projectId) {
      console.error("No selected project id available.");
      return;
    }

    try {
      if (assignMode === "existing") {
        if (!existingLayerId) return;

        const props = cleanProps(existingPropsDraft);

        await CreateFeature({
          layer_id: existingLayerId,
          feature_properties: props,
          feature_geom: geom,
        });

        const updated = await GetProjectLayerFeatures({ project_id: projectId });
        setFeatureLayers(updated);

        deletePendingDrawFromDrawControl();
        closeAssignModal();
        return;
      }

      // new layer
      const name = newLayerName.trim();
      if (!name) return;

      const props = cleanProps(cleanRowsToProps(newPropsRows));

      const createdLayer = await CreateLayer({
        project_id: projectId,
        layer_name: name,
      });

      const newLayerId = createdLayer?.id;
      if (!newLayerId) {
        console.error("CreateLayer returned no id");
        return;
      }

      await CreateFeature({
        layer_id: newLayerId,
        feature_properties: props,
        feature_geom: geom,
      });

      const updated = await GetProjectLayerFeatures({ project_id: projectId });
      setFeatureLayers(updated);

      deletePendingDrawFromDrawControl();
      closeAssignModal();
    } catch (err) {
      console.error("Failed saving feature:", err);
      // keep modal open so user can retry
    }
  };

  const onCancelAssign = () => {
    deletePendingDrawFromDrawControl();
    closeAssignModal();
  };

  // If user switches existing layer, re-shape draft to only those keys
  useEffect(() => {
    if (!isAssignModalOpen) return;
    if (assignMode !== "existing") return;

    const next: Record<string, string> = {};
    for (const k of sharedKeys) next[k] = existingPropsDraft[k] ?? "";
    setExistingPropsDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedKeys, assignMode, isAssignModalOpen]);

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

  // --- Attach Draw to Map + handlers ---
  useEffect(() => {
    const map = mapContext.mapRef.current;
    const draw = mapContext.drawRef.current;
    if (!map || !draw) return;

    if (!map.hasControl(draw as any)) map.addControl(draw as any);

    const onModeChange = (e: any) => setActiveMode(e.mode);
    map.on("draw.modechange", onModeChange);

    const onDrawCreate = (e: any) => {
      const f = e?.features?.[0] as
        | Feature<Geometry, GeoJsonProperties>
        | undefined;
      if (!f) return;

      const drawId = String(f.id ?? "");
      if (!drawId) return;

      setPendingDraw({ drawId, feature: f });
      setIsAssignModalOpen(true);

      const firstLayerId = featureLayers[0]?.layer.id ?? "";
      setExistingLayerId(firstLayerId);
      setAssignMode(firstLayerId ? "existing" : "new");
      setExistingPropsDraft({});
      setNewPropsRows([{ key: "", value: "" }]);
      setNewLayerName("");

      mapContext.drawRef.current?.changeMode("simple_select");
    };

    map.on("draw.create", onDrawCreate);

    return () => {
      map.off("draw.modechange", onModeChange);
      map.off("draw.create", onDrawCreate);
    };
  }, [mapContext, featureLayers]);

  // --- Fit On Bounds ---
  fitBoundsRef.current = () => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    const selectedFl = selectedLayer
      ? featureLayers.find((fl) => fl.layer.id === selectedLayer.id)
      : null;

    const featuresToFit = selectedFl
      ? selectedFl.features.filter((f) => f.is_visible)
      : featureLayers.flatMap((fl) => fl.features.filter((f) => f.is_visible));

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
        case "MultiPolygon": {
          const coords = geom.coordinates as any;
          const addCoords = (c: any) =>
            Array.isArray(c[0])
              ? c.forEach(addCoords)
              : bounds.extend(c as [number, number]);
          addCoords(coords);
          break;
        }
        case "GeometryCollection":
          geom.geometries.forEach((g) => extendCoords(g));
          break;
      }
    };

    featuresToFit.forEach((f) => extendCoords(f.geom));

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

    const darkenColor = (hex: string, amount: number) => {
      const c = hex.replace("#", "");
      const num = parseInt(c, 16);
      const r = Math.max(0, ((num >> 16) & 0xff) * (1 - amount));
      const g = Math.max(0, ((num >> 8) & 0xff) * (1 - amount));
      const b = Math.max(0, (num & 0xff) * (1 - amount));
      return `rgb(${r},${g},${b})`;
    };

    const updateLayers = () => {
      const currentLayerIds = new Set(
        featureLayers.flatMap((fl) => [
          `layer-${fl.layer.id}`,
          `layer-${fl.layer.id}-outline`,
        ])
      );

      // Remove obsolete layers and sources
      map.getStyle().layers?.forEach((l) => {
        if (l.id.startsWith("layer-") && !currentLayerIds.has(l.id)) {
          if (map.getLayer(l.id)) map.removeLayer(l.id);
          const sourceId = `source-${l.id.replace("layer-", "")}`;
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        }
      });

      // Add or update layers
      featureLayers.forEach((fl) => {
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
          } else if (renderType === "line") {
            map.addLayer({
              id: layerId,
              type: "line",
              source: sourceId,
              paint: {
                "line-width": fl.layer.style_size ?? 3,
                "line-color": fl.layer.style_color ?? "#3b82f6",
                "line-opacity": fl.layer.style_opacity ?? 1,
              },
            });
          } else if (renderType === "polygon") {
            const fillColor = fl.layer.style_color ?? "#22c55e";

            map.addLayer({
              id: layerId,
              type: "fill",
              source: sourceId,
              paint: {
                "fill-color": fillColor,
                "fill-opacity": fl.layer.style_opacity ?? 0.4,
              },
            });

            const outlineId = `${layerId}-outline`;
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
          }
        } else {
          // Update paint properties
          if (renderType === "point") {
            map.setPaintProperty(layerId, "circle-radius", fl.layer.style_size);
            map.setPaintProperty(layerId, "circle-color", fl.layer.style_color);
            map.setPaintProperty(
              layerId,
              "circle-opacity",
              fl.layer.style_opacity
            );
          } else if (renderType === "line") {
            map.setPaintProperty(layerId, "line-width", fl.layer.style_size);
            map.setPaintProperty(layerId, "line-color", fl.layer.style_color);
            map.setPaintProperty(
              layerId,
              "line-opacity",
              fl.layer.style_opacity
            );
          } else if (renderType === "polygon") {
            map.setPaintProperty(layerId, "fill-color", fl.layer.style_color);
            map.setPaintProperty(
              layerId,
              "fill-opacity",
              fl.layer.style_opacity
            );

            const outlineId = `${layerId}-outline`;
            if (map.getLayer(outlineId)) {
              map.setPaintProperty(outlineId, "line-color", fl.layer.style_color);
            }
          }
        }
      });

      // Keep order stable + outlines above fills
      featureLayers.forEach((fl) => {
        const layerId = `layer-${fl.layer.id}`;
        const outlineId = `${layerId}-outline`;
        if (map.getLayer(layerId)) map.moveLayer(layerId);
        if (map.getLayer(outlineId)) map.moveLayer(outlineId, layerId);
      });

      // Move highlight layers to the top
      [
        "highlight-layer",
        "highlight-layer-outline",
        "highlight-layer-point",
        "highlight-layer-line",
      ].forEach((id) => {
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
        layers: featureLayers.map((fl) => `layer-${fl.layer.id}`),
      });

      if (features.length) {
        const topFeature = features[0];
        const featureId = topFeature.properties?.__feature_id;
        const layerId = topFeature.properties?.__layer_id;
        const clickedLayer = featureLayers.find((fl) => fl.layer.id === layerId);

        if (clickedLayer) {
          setSelectedLayer(clickedLayer.layer);

          const clickedFeature = clickedLayer.features.find(
            (f) => f.id === featureId
          );
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

      const toGeoJSONFeature = (
        f: FeatureType
      ): Feature<Geometry, GeoJsonProperties> => ({
        type: "Feature",
        geometry: f.geom,
        properties: f.properties ?? {},
        id: f.id,
      });

      if (!map.getSource(highlightSourceId)) {
        map.addSource(highlightSourceId, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        map.addLayer({
          id: highlightLayerId,
          type: "fill",
          source: highlightSourceId,
          paint: { "fill-color": "#facc15", "fill-opacity": 0.8 },
        });

        map.addLayer({
          id: `${highlightLayerId}-outline`,
          type: "line",
          source: highlightSourceId,
          paint: { "line-color": "#b45309", "line-width": 2 },
        });

        map.addLayer({
          id: `${highlightLayerId}-point`,
          type: "circle",
          source: highlightSourceId,
          paint: {
            "circle-radius": 8,
            "circle-color": "#facc15",
            "circle-opacity": 1,
          },
        });

        map.addLayer({
          id: `${highlightLayerId}-line`,
          type: "line",
          source: highlightSourceId,
          paint: {
            "line-color": "#facc15",
            "line-width": 4,
            "line-opacity": 1,
          },
        });
      }

      if (selectedFeature && selectedLayer) {
        const geoFeature = toGeoJSONFeature(selectedFeature);

        (map.getSource(highlightSourceId) as maplibregl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: [geoFeature],
        });

        const geomType = selectedFeature.geom?.type;

        map.setLayoutProperty(
          `${highlightLayerId}-point`,
          "visibility",
          geomType?.includes("Point") ? "visible" : "none"
        );
        map.setLayoutProperty(
          `${highlightLayerId}-line`,
          "visibility",
          geomType?.includes("LineString") ? "visible" : "none"
        );
        map.setLayoutProperty(
          highlightLayerId,
          "visibility",
          geomType?.includes("Polygon") ? "visible" : "none"
        );
        map.setLayoutProperty(
          `${highlightLayerId}-outline`,
          "visibility",
          geomType?.includes("Polygon") ? "visible" : "none"
        );

        if (geomType?.includes("Point")) {
          map.setPaintProperty(
            `${highlightLayerId}-point`,
            "circle-radius",
            selectedLayer.style_size ?? 8
          );
        } else if (geomType?.includes("LineString")) {
          map.setPaintProperty(
            `${highlightLayerId}-line`,
            "line-width",
            selectedLayer.style_size ?? 4
          );
        }
      } else {
        map.setLayoutProperty(`${highlightLayerId}-point`, "visibility", "none");
        map.setLayoutProperty(`${highlightLayerId}-line`, "visibility", "none");
        map.setLayoutProperty(highlightLayerId, "visibility", "none");
        map.setLayoutProperty(`${highlightLayerId}-outline`, "visibility", "none");
      }
    };

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

      const gcpIndex = gcps.findIndex((g) => g.id === selectedGcp.id);
      if (gcpIndex === -1) return;

      const gcp = gcps[gcpIndex];
      if (gcp.px === null || gcp.py === null) return;

      const { lng, lat } = e.lngLat;

      const newGcps = [...gcps];
      newGcps[gcpIndex] = { ...gcp, lon: lng, lat: lat };
      setGcps(newGcps);

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
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);

        map.addSource(sourceId, {
          type: "raster",
          tiles: [rasterUrl],
          tileSize: 256,
        });

        map.addLayer({
          id: layerId,
          type: "raster",
          source: sourceId,
        });
      } catch (err) {
        console.error("Failed to add raster layer:", err);

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
  const handleDrawPoint = () =>
    mapContext.drawRef.current?.changeMode("draw_point");
  const handleDrawLine = () =>
    mapContext.drawRef.current?.changeMode("draw_line_string");
  const handleDrawPolygon = () =>
    mapContext.drawRef.current?.changeMode("draw_polygon");
  const handleTrash = async () => {
  const draw = mapContext.drawRef.current;
  const projectId = selectedProject?.id;

  // 1) If user has a draw feature selected (unsaved sketch), delete it from draw
  const selectedDrawIds = draw?.getSelectedIds?.() ?? [];
  if (selectedDrawIds.length > 0) {
    selectedDrawIds.forEach((id) => draw?.delete(id));
    return;
  }

  // 2) Otherwise delete the saved feature (from Supabase) if one is selected
  if (!selectedFeature || !projectId) return;

  try {
    await DeleteFeature({ feature_id: String(selectedFeature.id) });

    // clear selection so highlight disappears immediately
    setSelectedFeature(null);

    // refresh map layers/features
    const updated = await GetProjectLayerFeatures({ project_id: projectId });
    setFeatureLayers(updated);
  } catch (err) {
    console.error("Failed to delete feature:", err);
  }
};


  const buttonClass = (mode: string, baseColor: string) =>
    `px-3 py-1 rounded text-white ${
      activeMode === mode ? "brightness-125" : "hover:brightness-110"
    } ${baseColor}`;

  return (
    <div className="h-full relative">
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Zoom & Coords */}
      <div className="absolute bottom-0 left-2/5 -translate-x-1/2 bg-white/80 px-4 py-2 rounded-t-xl flex gap-4 text-black text-sm font-medium shadow-md">
        <p>
          <strong>Zoom:</strong> {zoom.toFixed(0)}
        </p>
        <p>
          <strong>Coords:</strong> {coords.lng.toFixed(2)}, {coords.lat.toFixed(2)}
        </p>
      </div>

      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 bg-white/80 px-4 py-2 rounded-t-xl flex gap-4 text-black text-sm font-medium shadow-md">
        <button
          className="bg-gray-400 cursor-pointer px-2 py-1 text-white"
          onClick={() => {
            setSelectedLayer(null);
            fitBoundsRef.current();
          }}
        >
          <i className="fa-solid fa-expand"></i>
        </button>
      </div>

      {/* Draw Buttons */}
      {drawMode && (
        <div className="absolute bottom-0 left-3/5 -translate-x-1/2 bg-white/80 px-4 py-2 rounded-t-xl flex gap-2 shadow-md">
          <button
            className={buttonClass("draw_point", "bg-gray-400")}
            onClick={handleDrawPoint}
          >
            <i className="fa-solid fa-location-dot"></i>
          </button>
          <button
            className={buttonClass("draw_line_string", "bg-gray-400")}
            onClick={handleDrawLine}
          >
            <i className="fa-solid fa-arrow-trend-up"></i>
          </button>
          <button
            className={buttonClass("draw_polygon", "bg-gray-400")}
            onClick={handleDrawPolygon}
          >
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

      {/* Assign Feature Modal */}
      {isAssignModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Add this drawing to a layer
                </h2>
                <p className="text-sm text-gray-600">
                  Pick an existing layer or create a new one. Properties are optional.
                </p>
              </div>

              <button
                className="text-gray-500 hover:text-gray-900"
                onClick={onCancelAssign}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="flex gap-3">
                <button
                  className={`px-3 py-2 rounded-lg border text-sm ${
                    assignMode === "existing"
                      ? "bg-gray-900 text-white"
                      : "bg-white text-gray-900 hover:bg-gray-50"
                  }`}
                  onClick={() => setAssignMode("existing")}
                  disabled={featureLayers.length === 0}
                  title={featureLayers.length === 0 ? "No layers exist yet" : ""}
                >
                  Existing layer
                </button>
                <button
                  className={`px-3 py-2 rounded-lg border text-sm ${
                    assignMode === "new"
                      ? "bg-gray-900 text-white"
                      : "bg-white text-gray-900 hover:bg-gray-50"
                  }`}
                  onClick={() => setAssignMode("new")}
                >
                  New layer
                </button>
              </div>

              {assignMode === "existing" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">
                      Choose layer
                    </label>
                    <select
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      value={existingLayerId}
                      onChange={(e) => setExistingLayerId(e.target.value)}
                    >
                      {featureLayers.map((fl) => (
                        <option key={fl.layer.id} value={fl.layer.id}>
                          {fl.layer.name ?? `Layer ${fl.layer.id}`}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      You’ll only see property fields shared by all features in this layer.
                    </p>
                  </div>

                  <div className="border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Properties (optional)
                      </h3>
                      <span className="text-xs text-gray-500">
                        {sharedKeys.length} fields
                      </span>
                    </div>

                    {sharedKeys.length === 0 ? (
                      <p className="text-sm text-gray-600">
                        This layer doesn’t have shared property keys yet (empty layer or mismatched schemas).
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {sharedKeys.map((k) => (
                          <div key={k}>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              {k}
                            </label>
                            <input
                              className="w-full border rounded-lg px-3 py-2 text-sm"
                              value={existingPropsDraft[k] ?? ""}
                              onChange={(e) =>
                                setExistingPropsDraft((prev) => ({
                                  ...prev,
                                  [k]: e.target.value,
                                }))
                              }
                              placeholder="(optional)"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {assignMode === "new" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">
                      New layer name
                    </label>
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      value={newLayerName}
                      onChange={(e) => setNewLayerName(e.target.value)}
                      placeholder="e.g., Recreational Parks"
                    />
                  </div>

                  <div className="border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Properties (optional)
                      </h3>
                      <button
                        className="text-sm px-3 py-1 rounded-lg border hover:bg-gray-50"
                        onClick={() =>
                          setNewPropsRows((prev) => [...prev, { key: "", value: "" }])
                        }
                      >
                        + Add property
                      </button>
                    </div>

                    <div className="space-y-2">
                      {newPropsRows.map((row, idx) => (
                        <div
                          key={idx}
                          className="grid grid-cols-12 gap-2 items-center"
                        >
                          <input
                            className="col-span-5 border rounded-lg px-3 py-2 text-sm"
                            value={row.key}
                            onChange={(e) => {
                              const v = e.target.value;
                              setNewPropsRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, key: v } : r
                                )
                              );
                            }}
                            placeholder="key (e.g., length)"
                          />
                          <input
                            className="col-span-6 border rounded-lg px-3 py-2 text-sm"
                            value={row.value}
                            onChange={(e) => {
                              const v = e.target.value;
                              setNewPropsRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, value: v } : r
                                )
                              );
                            }}
                            placeholder="value (optional)"
                          />
                          <button
                            className="col-span-1 text-gray-500 hover:text-red-600"
                            onClick={() => {
                              setNewPropsRows((prev) =>
                                prev.length === 1
                                  ? prev
                                  : prev.filter((_, i) => i !== idx)
                              );
                            }}
                            title="Remove"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>

                    <p className="text-xs text-gray-500 mt-2">
                      Leave blank if you don’t want metadata yet.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-lg border hover:bg-gray-50"
                onClick={onCancelAssign}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleSaveFeature}
                disabled={
                  assignMode === "existing"
                    ? !existingLayerId
                    : newLayerName.trim().length === 0
                }
              >
                Save feature
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapComponent;
