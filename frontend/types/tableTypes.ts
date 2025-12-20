import type { Geometry, GeoJsonProperties } from "geojson";

export type ProjectType = {
    id: string;
    name: string;
}

export type LayerType = {
    id: string;
    name: string;
    is_visible: boolean;
    order_index: number;
    style_color: string; // Feature color
    style_opacity: number; // Feature opacity
    style_size: number; // Line width | Point radius
}

export type LayerOrderType = {
  layer_id: string;
  order_index: number;
}

export type FeatureType = {
    id: string;
    layer_id: string;
    properties?: GeoJsonProperties;
    geom: Geometry;
    is_visible: boolean;
};

export type FeatureLayerType = {
    layer: LayerType;
    features: FeatureType[];
    is_expanded?: boolean;
}
