
export type GCPType = {
  id: number;
  px: number | null;
  py: number | null;
  lon: number | null;
  lat: number | null;
};

export type CSVPoint = {
  id: string;
  lon?: number;
  lat?: number;
};

export type RasterBounds = [
  [number, number], // top-left [lng, lat]
  [number, number], // top-right
  [number, number], // bottom-right
  [number, number], // bottom-left
];

export type CSVRow = {
  [key: string]: string | { lon: number; lat: number } | undefined;
  __coord?: { lon: number; lat: number };
};
