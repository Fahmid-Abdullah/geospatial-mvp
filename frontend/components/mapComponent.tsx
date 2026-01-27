"use client";

import { useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import maplibregl, { LngLatBounds } from "maplibre-gl";
import MapboxDraw from "maplibre-gl-draw";

import { MapContext } from "@/context/MapContext";
import { FeatureLayerType, FeatureType } from "@/types/tableTypes";
import { CreateFeature, CreateFeaturesBulk, DeleteFeature } from "@/actions/featureActions";
import { CreateLayer, GetProjectLayerFeatures } from "@/actions/layerActions";

import type { FeatureCollection, Geometry, GeoJsonProperties, Feature } from "geojson";
import { toast } from "react-toastify";

type PendingDraw = {
  drawId: string;
  feature: Feature<Geometry, GeoJsonProperties>;
};

// Helper Functions
const toFeatureCollection = (fl: FeatureLayerType): FeatureCollection<Geometry, GeoJsonProperties> => ({
  type: "FeatureCollection",
  features: fl.features
    .filter(f => f.is_visible)
    .map(f => ({
      type: "Feature",
      id: f.id,
      geometry: f.geom,
      properties: {
        ...(f.properties ?? {}),
        __feature_id: f.id,
        __layer_id: fl.layer.id,
      },
    })),
});

const getRenderType = (fc: FeatureCollection): "point" | "line" | "polygon" | null => {
  for (const f of fc.features) {
    if (!f.geometry?.type) continue;
    const t = f.geometry.type;
    if (t === "Point" || t === "MultiPoint") return "point";
    if (t === "LineString" || t === "MultiLineString") return "line";
    if (t === "Polygon" || t === "MultiPolygon") return "polygon";
  }
  return null;
};

interface MapComponentProps {
  drawMode: boolean;
  refreshData: () => void;
}

const MapComponent = ({ drawMode, refreshData }: MapComponentProps) => {
  const mapContext = useContext(MapContext);
  if (!mapContext) return null;

  // States
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [pendingDraw, setPendingDraw] = useState<PendingDraw | null>(null);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignMode, setAssignMode] = useState<"existing" | "new">("existing");
  const [existingLayerId, setExistingLayerId] = useState("");
  const [newLayerName, setNewLayerName] = useState("");
  const [existingPropsDraft, setExistingPropsDraft] = useState<Record<string, string>>({});
  const [newPropsRows, setNewPropsRows] = useState([{ key: "", value: "" }]);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const fitBoundsRef = useRef<(layerId?: string) => void>(() => {});

  const [zoom, setZoom] = mapContext.zoomState;
  const [coords, setCoords] = mapContext.coordsState;
  const [featureLayers, setFeatureLayers] = mapContext.featurelayerState;
  const [selectedProject] = mapContext.selectedProjectState;
  const [selectedFeature, setSelectedFeature] = mapContext.selectedFeatureState;
  const [selectedFeatures, setSelectedFeatures] = useState<FeatureType[]>([]);
  const [selectedLayer, setSelectedLayer] = mapContext.selectedLayerState;
  const [selectedGcp, setSelectedGcp] = mapContext.selectedGcpPathState;
  const [gcps, setGcps] = mapContext.gcpPathState;
  const [rasterUrl] = mapContext.rasterUrlState;
  const [rasterBounds] = mapContext.rasterBounds;
  const [rasterVisiblity] = mapContext.rasterVisibility;
  const [rasterOpacity] = mapContext.rasterOpacity;
  const [csvRows, setCsvRows] = mapContext.csvRows;
  const [isGeoreferencing] = mapContext.isGeoreferencingState;


  // Derived
  const sharedKeys = useMemo(() => {
    if (!existingLayerId) return [];
    const fl = featureLayers.find(f => f.layer.id === existingLayerId);
    if (!fl || !fl.features.length) return [];
    let shared = new Set(Object.keys(fl.features[0].properties ?? {}));
    fl.features.slice(1).forEach(f => {
      shared = new Set([...shared].filter(k => Object.keys(f.properties ?? {}).includes(k)));
    });
    return [...shared].filter(k => !k.startsWith("__")).sort();
  }, [existingLayerId, featureLayers]);

  // Modal Helpers
  const resetAssignModalState = () => {
    const firstLayer = featureLayers[0]?.layer.id ?? "";
    setAssignMode(firstLayer ? "existing" : "new");
    setExistingLayerId(firstLayer);
    setNewLayerName("");
    setExistingPropsDraft({});
    setNewPropsRows([{ key: "", value: "" }]);
  };

  const closeAssignModal = () => {
    setIsAssignModalOpen(false);
    setPendingDraw(null);
    resetAssignModalState();
  };

  const deletePendingDraw = () => {
    const draw = mapContext.drawRef.current;
    if (!draw || !pendingDraw) return;
    try {
      draw.delete(pendingDraw.drawId);
    } catch {}
  };

  const handleSaveFeature = useCallback(async () => {
    if (!pendingDraw || !pendingDraw.feature.geometry || !selectedProject?.id) return;

    try {
      if (assignMode === "existing") {
        if (!existingLayerId) return;
        await CreateFeature({
          layer_id: existingLayerId,
          feature_properties: cleanProps(existingPropsDraft),
          feature_geom: pendingDraw.feature.geometry,
        });
      } else {
        if (!newLayerName.trim()) return;
        const layer = await CreateLayer({ project_id: selectedProject.id, layer_name: newLayerName.trim() });
        if (!layer?.id) return;
        await CreateFeature({
          layer_id: layer.id,
          feature_properties: cleanProps(cleanRowsToProps(newPropsRows)),
          feature_geom: pendingDraw.feature.geometry,
        });
      }
      const updated = await GetProjectLayerFeatures({ project_id: selectedProject.id });
      setFeatureLayers(updated);
      deletePendingDraw();
      closeAssignModal();
    } catch (err) {
      console.error("Failed saving feature:", err);
    }
  }, [assignMode, existingLayerId, existingPropsDraft, newLayerName, newPropsRows, pendingDraw, selectedProject, setFeatureLayers]);

  const handleTrash = useCallback(async () => {
    const draw = mapContext.drawRef.current;
    const selectedIds = draw?.getSelectedIds?.() ?? [];
    if (selectedIds.length > 0) {
      selectedIds.forEach(id => draw?.delete(id));
      return;
    }

    if (!selectedFeature || !selectedProject?.id) return;

    try {
      await DeleteFeature({ feature_id: String(selectedFeature.id) });
      setSelectedFeature(null);
      const updated = await GetProjectLayerFeatures({ project_id: selectedProject.id });
      setFeatureLayers(updated);
    } catch (err) {
      console.error("Failed to delete feature:", err);
    }
  }, [selectedFeature, selectedProject, setFeatureLayers, setSelectedFeature, mapContext.drawRef]);

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

  const onCancelAssign = () => {
    deletePendingDrawFromDrawControl();
    closeAssignModal();
  };

  // --- Memoize GeoJSON and layer bounds ---
  const geojsonByLayer = useMemo(() => {
    const map = new Map<string, FeatureCollection<Geometry, GeoJsonProperties>>();
    const boundsByLayer = new Map<string, maplibregl.LngLatBounds>();
    
    featureLayers.forEach((fl) => {
      const geojson = toFeatureCollection(fl);
      map.set(fl.layer.id, geojson);

      // Precompute bounds for the layer
      const bounds = new maplibregl.LngLatBounds();
      geojson.features.forEach((f) => {
        if (!f.geometry) return;
        const extendCoords = (geom: Geometry) => {
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
              geom.geometries.forEach(extendCoords);
              break;
          }
        };
        extendCoords(f.geometry);
      });
      boundsByLayer.set(fl.layer.id, bounds);
    });

    return { geojsonByLayer: map, boundsByLayer };
  }, [featureLayers]);

  // If user switches existing layer, re-shape draft to only those keys
  useEffect(() => {
    if (!isAssignModalOpen) return;
    if (assignMode !== "existing") return;

    const next: Record<string, string> = {};
    for (const k of sharedKeys) next[k] = existingPropsDraft[k] ?? "";
    setExistingPropsDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedKeys, assignMode, isAssignModalOpen]);

  // Initialize Map
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

  // Initialize Draw
  useEffect(() => {
    if (!mapContext || mapContext.drawRef.current) return;

    const draw = new MapboxDraw({ displayControlsDefault: false });
    mapContext.drawRef.current = draw;
  }, [mapContext]);

  // Attach Draw to Map + handlers
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

  // fitBounds to layer
  fitBoundsRef.current = (layerId?: string) => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    let bounds: maplibregl.LngLatBounds | null = null;

    if (layerId) {
      bounds = geojsonByLayer.boundsByLayer.get(layerId) || null;
    } else {
      bounds = new maplibregl.LngLatBounds();
      geojsonByLayer.boundsByLayer.forEach((b) => bounds!.extend(b));
      if (bounds.isEmpty()) return;
    }

    map.fitBounds(bounds as LngLatBounds, {
      padding: { top: 50, bottom: 50, left: 600, right: 500 },
      maxZoom: 10,
      duration: 800,
    });
  };

  // bounds from GeoJSON features
  const boundsFromFeatures = (features: Feature<Geometry>[]) => {
    const bounds = new maplibregl.LngLatBounds();

    const extend = (geom: Geometry) => {
      const walk = (c: any) =>
        Array.isArray(c[0]) ? c.forEach(walk) : bounds.extend(c);

      if (geom.type === "GeometryCollection") {
        geom.geometries.forEach(extend);
      } else {
        walk(geom.coordinates as any);
      }
    };

    features.forEach(f => f.geometry && extend(f.geometry));
    return bounds.isEmpty() ? null : bounds;
  };

  // fitBounds to selected features
  const fitToSelectedFeatures = () => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    if (!selectedFeatures.length) return;

    const bounds = boundsFromFeatures(
      selectedFeatures.map(f => ({
        type: "Feature",
        geometry: f.geom,
        properties: {},
      }))
    );

    if (!bounds) return;

    map.fitBounds(bounds as LngLatBounds, {
      padding: { top: 50, bottom: 50, left: 600, right: 500 },
      maxZoom: 16,
      duration: 800,
    });
  };

  // Render & Update Feature Layers
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
      const currentLayerIds = new Set(featureLayers.flatMap(fl => [`layer-${fl.layer.id}`, `layer-${fl.layer.id}-outline`]));

      // Remove obsolete layers and sources
      map.getStyle().layers?.forEach((l) => {
        if (l.id.startsWith("layer-") && !currentLayerIds.has(l.id)) {
          if (map.getLayer(l.id)) map.removeLayer(l.id);
          const sourceId = `source-${l.id.replace("layer-", "")}`;
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        }
      });

      // Add/update layers
      featureLayers.forEach((fl) => {
        const layerId = `layer-${fl.layer.id}`;
        const sourceId = `source-${fl.layer.id}`;
        const geojson = geojsonByLayer.geojsonByLayer.get(fl.layer.id);
        if (!geojson) return;
        const renderType = getRenderType(geojson);
        if (!renderType) return;

        if (map.getSource(sourceId)) {
          (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(geojson);
        } else {
          map.addSource(sourceId, { type: "geojson", data: geojson });
        }

        if (!map.getLayer(layerId)) {
          // Add new layer
          if (renderType === "point") {
            map.addLayer({ id: layerId, type: "circle", source: sourceId, paint: { "circle-radius": fl.layer.style_size ?? 5, "circle-color": fl.layer.style_color ?? "#3b82f6", "circle-opacity": fl.layer.style_opacity ?? 1 } });
          } else if (renderType === "line") {
            map.addLayer({ id: layerId, type: "line", source: sourceId, paint: { "line-width": fl.layer.style_size ?? 3, "line-color": fl.layer.style_color ?? "#3b82f6", "line-opacity": fl.layer.style_opacity ?? 1 } });
          } else if (renderType === "polygon") {
            const fillColor = fl.layer.style_color ?? "#22c55e";
            map.addLayer({ id: layerId, type: "fill", source: sourceId, paint: { "fill-color": fillColor, "fill-opacity": fl.layer.style_opacity ?? 0.4 } });
            map.addLayer({ id: `${layerId}-outline`, type: "line", source: sourceId, paint: { "line-color": darkenColor(fillColor, 0.3), "line-width": 2 } }, layerId);
          }
        } else {
          // Update paint properties only
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
            if (map.getLayer(outlineId)) map.setPaintProperty(outlineId, "line-color", fl.layer.style_color);
          }
        }
      });
    };

    if (!map.isStyleLoaded()) {
      map.once("load", () => {
        updateLayers();
        enforceLayerOrder();
        fitBoundsRef.current(selectedLayer?.id);
      });
    } else {
      updateLayers();
      enforceLayerOrder();
      fitBoundsRef.current(selectedLayer?.id);
    }
  }, [featureLayers, geojsonByLayer]);

  // After updating/adding all layers:
  const enforceLayerOrder = () => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    // Raster on bottom (under all features)
    const rasterLayerId = "georef-image-layer";
    if (map.getLayer(rasterLayerId)) {
      const firstFeatureLayerId = featureLayers[0] ? `layer-${featureLayers[0].layer.id}` : undefined;
      if (firstFeatureLayerId) {
        map.moveLayer(rasterLayerId, firstFeatureLayerId);
      }
    }

    // Feature layers in order of featureLayers array
    featureLayers.forEach((fl, idx) => {
      const layerId = `layer-${fl.layer.id}`;
      const outlineId = `${layerId}-outline`;
      const nextLayerId = featureLayers[idx + 1] ? `layer-${featureLayers[idx + 1].layer.id}` : undefined;

      if (map.getLayer(layerId)) {
        if (nextLayerId) map.moveLayer(layerId, nextLayerId);
      }
      if (map.getLayer(outlineId)) {
        if (nextLayerId) map.moveLayer(outlineId, nextLayerId);
      }
    });

    // Highlight on top
    ["highlight-layer", "highlight-layer-outline", "highlight-layer-point", "highlight-layer-line"].forEach((id) => {
      if (map.getLayer(id)) map.moveLayer(id);
    });

    // Temporary layers (CSV, GCP) above everything else
    ["temp-csv-layer", "temp-gcp-layer"].forEach((id) => {
      if (map.getLayer(id)) map.moveLayer(id);
    });
  };

  // Feature Click
  useEffect(() => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    // TS now knows map is definitely Map, not null
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (isGeoreferencing && selectedGcp) {
        // GCP click logic
        const gcpIndex = gcps.findIndex((g) => g.id === selectedGcp.id);
        if (gcpIndex !== -1) {
          const gcp = gcps[gcpIndex];
          const newGcps = [...gcps];
          newGcps[gcpIndex] = { ...gcp, lon: e.lngLat.lng, lat: e.lngLat.lat };
          setGcps(newGcps);
        }
        return; // stop further processing
      }

      // Feature selection logic
      const queryLayers = featureLayers
        .filter((fl) => fl.features.some((f) => f.is_visible))
        .map((fl) => `layer-${fl.layer.id}`);

      if (!queryLayers.length) return;

      const features = map.queryRenderedFeatures(e.point, { layers: queryLayers });
      if (!features.length) return;

      const topFeature = features[0];
      const featureId = topFeature.properties?.__feature_id;
      const layerId = topFeature.properties?.__layer_id;
      const clickedLayer = featureLayers.find((fl) => fl.layer.id === layerId);

      if (!isGeoreferencing && clickedLayer && featureId != null) {
        setSelectedLayer(clickedLayer.layer);
        const clickedFeature = clickedLayer.features.find(f => f.id === featureId);
        if (!clickedFeature) return;

        if (e.originalEvent.shiftKey) {
          // MULTI SELECT
          setSelectedFeatures(prev => {
            const exists = prev.some(f => f.id === clickedFeature.id);
            return exists
              ? prev.filter(f => f.id !== clickedFeature.id)
              : [...prev, clickedFeature];
          });
        } else {
          // SINGLE SELECT
          setSelectedFeatures([clickedFeature]);
          setSelectedFeature(clickedFeature);
        }
      }
    };

    map.on("click", handleClick);

    return () => {
      map.off("click", handleClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureLayers, selectedLayer, isGeoreferencing]);

  // Highlight Selected Feature(s)
  useEffect(() => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    const SOURCE_ID = "highlight-source";
    const LAYER_ID = "highlight-layer";

    const toGeoJSONFeature = (
      f: FeatureType
    ): Feature<Geometry, GeoJsonProperties> => ({
      type: "Feature",
      geometry: f.geom,
      properties: f.properties ?? {},
      id: f.id,
    });

    const ensureHighlightLayers = () => {
      if (map.getSource(SOURCE_ID)) return;

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      // Polygon fill
      map.addLayer({
        id: LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": "#f59e0b",
          "fill-opacity": 0.9,
        },
      });

      // Polygon outline
      map.addLayer({
        id: `${LAYER_ID}-outline`,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#b45309",
          "line-width": 3,
        },
      });

      // Line highlight
      map.addLayer({
        id: `${LAYER_ID}-line`,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#f59e0b",
          "line-width": 5,
          "line-opacity": 1,
        },
      });

      // Point highlight
      map.addLayer({
        id: `${LAYER_ID}-point`,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": 10,
          "circle-color": "#f59e0b",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": 1,
        },
      });
    };

    const hideAll = () => {
      [
        `${LAYER_ID}-point`,
        `${LAYER_ID}-line`,
        LAYER_ID,
        `${LAYER_ID}-outline`,
      ].forEach(id => {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", "none");
        }
      });
    };

    const updateHighlight = () => {
      ensureHighlightLayers();

      if (!selectedFeatures?.length || !selectedLayer) {
        hideAll();
        return;
      }

      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
      if (!source) return;

      source.setData({
        type: "FeatureCollection",
        features: selectedFeatures.map(toGeoJSONFeature),
      });

      const geomTypes = new Set(
        selectedFeatures.map(f => f.geom?.type ?? "")
      );

      const hasPoint = [...geomTypes].some(t => t.includes("Point"));
      const hasLine = [...geomTypes].some(t => t.includes("LineString"));
      const hasPolygon = [...geomTypes].some(t => t.includes("Polygon"));

      // Visibility
      map.setLayoutProperty(
        `${LAYER_ID}-point`,
        "visibility",
        hasPoint ? "visible" : "none"
      );
      map.setLayoutProperty(
        `${LAYER_ID}-line`,
        "visibility",
        hasLine ? "visible" : "none"
      );
      map.setLayoutProperty(
        LAYER_ID,
        "visibility",
        hasPolygon ? "visible" : "none"
      );
      map.setLayoutProperty(
        `${LAYER_ID}-outline`,
        "visibility",
        hasPolygon ? "visible" : "none"
      );

      // Dynamic sizing from layer style
      if (hasPoint) {
        map.setPaintProperty(
          `${LAYER_ID}-point`,
          "circle-radius",
          (selectedLayer.style_size ?? 8) + 2
        );
      }

      if (hasLine) {
        map.setPaintProperty(
          `${LAYER_ID}-line`,
          "line-width",
          (selectedLayer.style_size ?? 4) + 2
        );
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("load", updateHighlight);
    } else {
      updateHighlight();
    }
  }, [selectedFeatures, selectedLayer]);

  // Handle Map Click for Georeferencing
  useEffect(() => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    const handleGcpMapClick = (e: maplibregl.MapMouseEvent) => {
      if (!isGeoreferencing || selectedGcp === null) return;

      const gcpIndex = gcps.findIndex((g) => g.id === selectedGcp.id);
      if (gcpIndex === -1) return;

      const gcp = gcps[gcpIndex];

      const { lng, lat } = e.lngLat;

      const newGcps = [...gcps];
      newGcps[gcpIndex] = { ...gcp, lon: lng, lat: lat };
      setGcps(newGcps);
    };

    map.on("click", handleGcpMapClick);

    return () => {
      map.off("click", handleGcpMapClick);
    };
  }, [isGeoreferencing, selectedGcp, gcps]);

  // TEMP GCP POINT LAYER
  useEffect(() => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    const sourceId = "temp-gcp-source";
    const layerId = "temp-gcp-layer";

    const updateLayer = () => {
      const features = gcps
        .filter((g) => g.lon != null && g.lat != null)
        .map((g) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [g.lon!, g.lat!] },
          properties: { id: g.id },
        }));

      if (features.length === 0) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        return;
      }

      const geojson = { type: "FeatureCollection" as const, features };

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: "geojson", data: geojson });

        map.addLayer({
          id: layerId,
          type: "circle",
          source: sourceId,
          paint: {
            "circle-radius": 8,
            "circle-color": "#f59e0b", // amber for temporary
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
      } else {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(geojson);
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("load", updateLayer);
    } else {
      updateLayer();
    }
  }, [gcps]);

  // TEMP CSV POINT LAYER
  useEffect(() => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    const sourceId = "temp-csv-source";
    const layerId = "temp-csv-layer";

    const updateLayer = () => {
      // map csvRows with coordinates to GeoJSON features
      const features = csvRows
        .filter((row) => row.__coord?.lon != null && row.__coord?.lat != null)
        .map((row) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [row.__coord!.lon, row.__coord!.lat],
          },
          properties: { id: row.id ?? "" },
        }));

      // remove layer/source if no features
      if (features.length === 0) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        return;
      }

      const geojson = { type: "FeatureCollection" as const, features };

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: "geojson", data: geojson });

        map.addLayer({
          id: layerId,
          type: "circle",
          source: sourceId,
          paint: {
            "circle-radius": 6,
            "circle-color": "#10b981", // teal for CSV points
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
      } else {
        // update existing source
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(geojson);
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("load", updateLayer);
    } else {
      updateLayer();
    }
  }, [csvRows]);

  // Render Raster Image Layer
  useEffect(() => {
    const map = mapContext.mapRef.current;
    if (!map) return;

    const sourceId = "georef-image";
    const layerId = "georef-image-layer";

    // If URL or bounds are missing, remove existing layer/source
    if (!rasterUrl || !rasterBounds) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      return;
    }

    const updateRasterLayer = () => {
      // Remove previous layer/source if exists
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);

      // Add the image source
      map.addSource(sourceId, {
        type: "image",
        url: rasterUrl,
        coordinates: rasterBounds,
      });

      // Add the raster layer
      map.addLayer({
        id: layerId,
        type: "raster",
        source: sourceId,
        paint: {
          "raster-opacity": rasterOpacity ?? 0.8,
        },
      });

      // Make it visible according to rasterVisiblity
      map.setLayoutProperty(layerId, "visibility", rasterVisiblity ? "visible" : "none");

      // Ensure it's above the first feature layer if exists
      if (featureLayers[0]) {
        const firstLayerId = `layer-${featureLayers[0].layer.id}`;
        if (map.getLayer(firstLayerId)) map.moveLayer(layerId, firstLayerId);
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("load", updateRasterLayer);
    } else {
      updateRasterLayer();
    }
  }, [rasterUrl, rasterBounds, rasterOpacity, rasterVisiblity, featureLayers]);

  const createLayerFromSelection = async () => {
    if (!selectedProject?.id || !selectedFeatures.length) return;

    const feature_ids = selectedFeatures.map(feature => feature.id);
    
    try {
      if (!selectedProject) return;
      await CreateFeaturesBulk({ project_id: selectedProject.id, feature_ids });

      refreshData();
      toast.success("Custom Layer Created!");
    } catch (err) {
      console.log(err);
      toast.error("Bulk Feature Creation Error.");
    }

    setSelectedFeatures([]);
    setSelectedFeature(null);

    const updated = await GetProjectLayerFeatures({ project_id: selectedProject.id });
    setFeatureLayers(updated);
  };

  const clearSelected = () => {
    setSelectedFeatures([]);
    setSelectedLayer(null);
  }

  // Draw Handlers
  const handleDrawPoint = () =>
    mapContext.drawRef.current?.changeMode("draw_point");
  const handleDrawLine = () =>
    mapContext.drawRef.current?.changeMode("draw_line_string");
  const handleDrawPolygon = () =>
    mapContext.drawRef.current?.changeMode("draw_polygon");
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

      <div className="absolute bottom-0 left-2/3 -translate-x-1/2 bg-white/80 px-4 py-2 rounded-t-xl flex gap-4 text-black text-sm font-medium shadow-md">
        <button
          className="bg-gray-400 cursor-pointer px-2 py-1 text-white"
          onClick={() => {
            setSelectedLayer(null);
            fitBoundsRef.current();
          }}
          title="Fit to selected layer"
        >
          <i className="fa-solid fa-expand"></i>
        </button>
        <button
          className="bg-gray-400 px-3 py-1 text-white rounded cursor-pointer"
          onClick={fitToSelectedFeatures}
          title="Fit to selected features"
        >
          <i className="fa-solid fa-maximize"></i>
        </button>
      </div>

      {selectedFeatures.length > 1 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2
                          bg-amber-500 text-white px-4 py-2 rounded-full
                          shadow-lg text-sm font-semibold flex gap-4">
            {selectedFeatures.length} features selected

          <button
            className="text-white cursor-pointer"
            onClick={clearSelected}
            title="Clear Selection">
            <i className="fa-solid fa-x"></i>
          </button>
          <button
            className="text-white cursor-pointer"
            onClick={createLayerFromSelection}
            title="Create new layer">
            <i className="fa-solid fa-save"></i>
          </button>
        </div>
      )}

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
