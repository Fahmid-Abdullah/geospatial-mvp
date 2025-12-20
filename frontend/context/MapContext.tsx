import { GCPType } from "@/types/gcpTypes";
import { ProjectType, LayerType, FeatureType, FeatureLayerType } from "@/types/tableTypes";
import maplibregl from "maplibre-gl";
import MapboxDraw from "maplibre-gl-draw";
import { createContext } from "react";

type LngLat = { lng: number; lat: number };

export const MapContext = createContext<{
  mapRef: React.RefObject<maplibregl.Map | null>;
  drawRef: React.RefObject<MapboxDraw | null>;

  zoomState: [
    number,
    React.Dispatch<React.SetStateAction<number>>
  ];

  coordsState: [
    LngLat,
    React.Dispatch<React.SetStateAction<LngLat>>
  ];

  selectedProjectState: [
    ProjectType | null,
    React.Dispatch<React.SetStateAction<ProjectType | null>>
  ];

  selectedLayerState: [
    LayerType | null,
    React.Dispatch<React.SetStateAction<LayerType | null>>
  ];

  selectedFeatureState: [
    FeatureType | null,
    React.Dispatch<React.SetStateAction<FeatureType | null>>
  ];

  featurelayerState: [
    FeatureLayerType[],
    React.Dispatch<React.SetStateAction<FeatureLayerType[]>>
  ];

  isGeoreferencingState: [
    boolean,
    React.Dispatch<React.SetStateAction<boolean>>
  ]

  imageUrlState: [
    string | null,
    React.Dispatch<React.SetStateAction<string | null>>
  ]

  imagePathState: [
    string | null,
    React.Dispatch<React.SetStateAction<string | null>>
  ]

  gcpPathState: [
    GCPType[],
    React.Dispatch<React.SetStateAction<GCPType[]>>
  ]

  selectedGcpPathState: [
    GCPType | null,
    React.Dispatch<React.SetStateAction<GCPType | null>>
  ]

  rasterUrlState: [
    string | null,
    React.Dispatch<React.SetStateAction<string | null>>
  ]

} | null>(null);
