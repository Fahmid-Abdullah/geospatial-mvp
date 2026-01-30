"use client"

import { MapContext } from "@/context/MapContext";
import { FeatureLayerType, FeatureType, LayerOrderType, LayerType, ProjectType } from "@/types/tableTypes";
import { ChangeEvent, Dispatch, SetStateAction, useContext, useEffect, useState } from "react"
import { DeleteLayer, GetProjectLayerFeatures, UpdateLayer, UpdateLayerOrder, UpdateLayerVisibility } from "@/actions/layerActions";
import { DeleteFeature, UpdateAllLayerFeatureVisibility, UpdateFeatureVisibility } from "@/actions/featureActions";
import { toast } from "react-toastify";
import { CreateProject, DeleteProject, GetProjects, UpdateProject } from "@/actions/projectActions";
import ModalPortal from "./ModalPortal";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React from "react";

type CSVPreviewType = {
  file: File;
  headers: string[];
  previewRows: Record<string, string>[];
};

type csvModalProps = {
  toggleCSVModal: () => void;
  headers: string[];
  previewRows: Record<string, string>[];
  file: File;
  setStatus: Dispatch<SetStateAction<string>>;
  toggleUploadModal: () => void;
  getFeatureLayers: () => void;
  csvType: "coordinates" | "addresses" | null
};

const CSVModal = ({ toggleCSVModal, headers, previewRows, file, setStatus, toggleUploadModal, getFeatureLayers, csvType }: csvModalProps) => {
  const mContext = useContext(MapContext); // Get Map Context
  if (!mContext) return;
  const [selectedProject, _setSelectedProject] = mContext?.selectedProjectState;

  const [latCol, setLatCol] = useState<string>("");
  const [lonCol, setLonCol] = useState<string>("");
  const [addressCol, setAddressCol] = useState<string>("");
  const [includedCols, setIncludedCols] = useState<Set<string>>(
    new Set(headers)
  );
  const [loading, setLoading] = useState(false);

  const toggleColumn = (col: string) => {
    setIncludedCols(prev => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });
  };

  const parseCSV = async () => {
    if (csvType === "coordinates") {
      if (!latCol || !lonCol) {
        toast.error("Please select latitude and longitude columns.");
        return;
      }
    }

    if (csvType === "addresses" && !addressCol) {
      if (!addressCol) {
        toast.error("Please select latitude and longitude columns.");
        return;
      }
    }

    setLoading(true);

    try {
      if (!file) {
        toast.error("CSV file not found.");
        return;
      }

      // Read CSV file as text
      const text = await file.text();

      let res;

      // Parse CSV
      if (csvType === "coordinates") {
        res = await fetch("/api/csv/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            csv_text: text,
            latCol,
            lonCol,
            includedCols: Array.from(includedCols),
            project_id: selectedProject?.id,
            fileName: file.name,
          }),
        });
      } else if (csvType === "addresses") {
        res = await fetch("/api/csv/convertLatLon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            csv_text: text,
            addressCol,
            includedCols: Array.from(includedCols),
            project_id: selectedProject?.id,
            fileName: file.name,
          }),
        });
      } else {
        toast.error("Invalid CSV Type.");
        return;
      }

      const data = await res.json();

      if (res.ok) {
        toast.success("CSV uploaded and features inserted successfully!");
        setStatus("CSV upload completed.");
        toggleCSVModal();
        getFeatureLayers();
        toggleUploadModal();
      } else {
        toast.error(data.error || "CSV upload failed.");
        setStatus("CSV upload failed.");
      }
    } catch (err: any) {
      console.error(err);
      toast.error("CSV processing error.");
      setStatus(`Error: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center text-black">
      <div className="w-2/3 bg-white rounded-xl p-6 relative">
        {/* Close */}
        <button
          onClick={toggleCSVModal}
          disabled={loading}
          className="absolute top-4 right-4 hover:scale-110 transition"
        >
          <i className="fa-solid fa-xmark text-lg" />
        </button>

        <h2 className="text-xl font-bold mb-4">CSV Preview & Mapping</h2>

        {/* Lat / Lon selectors */}
        {csvType === "coordinates" && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-sm text-gray-500">Latitude column</label>
              <select
                value={latCol}
                onChange={e => setLatCol(e.target.value)}
                className="w-full border rounded px-2 py-1"
              >
                <option value="">Select</option>
                {headers.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-gray-500">Longitude column</label>
              <select
                value={lonCol}
                onChange={e => setLonCol(e.target.value)}
                className="w-full border rounded px-2 py-1"
              >
                <option value="">Select</option>
                {headers.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Address selector */}
        {csvType === "addresses" && (
            <div>
              <label className="text-sm text-gray-500">Address column</label>
              <select
                value={addressCol}
                onChange={e => setAddressCol(e.target.value)}
                className="w-full border rounded px-2 py-1"
              >
                <option value="">Select</option>
                {headers.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
        )}

        {/* Column toggles */}
        <div className="mb-4">
          <p className="text-sm text-gray-500 mb-2">Columns to keep</p>
          <div className="grid grid-cols-3 gap-2">
            {headers.map(col => (
              <label
                key={col}
                className="flex items-center gap-2 text-sm bg-gray-100 p-2 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={includedCols.has(col)}
                  onChange={() => toggleColumn(col)}
                />
                {col}
              </label>
            ))}
          </div>
        </div>

        {/* Preview table */}
        <div className="max-h-40 overflow-auto border rounded mb-4">
          <table className="w-full text-xs">
            <thead className="bg-gray-200 sticky top-0">
              <tr>
                {headers.map(h => (
                  <th key={h} className="px-2 py-1 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i} className="odd:bg-gray-50">
                  {headers.map(h => (
                    <td key={h} className="px-2 py-1 truncate max-w-37.5">
                      {row[h]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Confirm */}
        <button
          disabled={loading}
          onClick={parseCSV}
          className="w-full bg-gray-400 hover:bg-gray-600 text-white py-2 rounded transition cursor-pointer"
        >
          {loading ? "Processing…" : "Confirm CSV Mapping"}
        </button>
      </div>
    </div>
  );
};

type uploadModalProps = {
  project_id: string | undefined;
  toggleUploadModal: () => void;
  getFeatureLayers: () => void;
}

const UploadModal = ({ project_id, toggleUploadModal, getFeatureLayers }: uploadModalProps) => {
  if (!project_id) {
    return;
  }

  const [statusText, setStatusText] = useState("");
  const [loading, setLoading] = useState(false);

  const mContext = useContext(MapContext);
  if (!mContext) {
    toast.error("Map Context Not Found.");
    throw Error("Map Context Not Found.");
  }
  const [_imageUrl, setImageUrl] = mContext.imageUrlState;
  const [_imagePath, setImagePath] = mContext.imagePathState;
  const [_isGeoreferencing, setIsGeoreferencing] = mContext.isGeoreferencingState;
  const [_isCSV, setIsCSV] = mContext.isCSVState;

  const [csvPreviewModal, setCSVPreviewModal] = useState<boolean>(false);
  const [csvData, setCsvData] = useState<CSVPreviewType>();
  const [csvType, setCSVType] = useState<"coordinates" | "addresses" | null>(null);

  const toggleCSVModal = () => setCSVPreviewModal(prev => !prev);

  const uploadGeoShp = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || loading) return;

    setLoading(true);
    setStatusText("Uploading…");

    try {
      const form = new FormData;
      form.append("file", file);
      form.append("project_id", project_id);

      const res = await fetch("/api/upload/geoshp", {
        method: "POST",
        body: form,
      });

      const data = await res.json();

      if (!data) {
        setStatusText("Upload Failed.");
        toast.error("Data Upload Failed.");
      } else {
        setStatusText("Upload successful.");
        toast.success("Data Uploaded Succcessfully!");
        getFeatureLayers();
        toggleUploadModal();
      }
    } catch (err) {
      console.error(err);
      setStatusText(
        `Error: ${err instanceof Error ? err.message : String(err)}`
      );
      toast.error("File Upload Error.");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const uploadCSV = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || loading) return;

    setLoading(true);
    setStatusText("Uploading…");

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/csv/preview", {
        method: "POST",
        body: form,
      });

      const data = await res.json();

      if (!data || !Array.isArray(data.headers) || !Array.isArray(data.previewRows)) {
        throw new Error("Invalid CSV response from server.");
      }

      // Make sure previewRows only include keys from headers
      const cleanedRows = data.previewRows.map((row: Record<string, any>) =>
        data.headers.reduce((acc: Record<string, string>, h: string) => {
          acc[h] = row[h]?.toString() ?? "";
          return acc;
        }, {})
      );

      const csvPreview: CSVPreviewType = {
        file,
        headers: data.headers,
        previewRows: cleanedRows,
      };

      setCsvData(csvPreview);
      toggleCSVModal();
      setStatusText("CSV Loaded Successfully!");
      toast.success("CSV Loaded!");
    } catch (err: any) {
      console.error(err);
      setStatusText(`Error: ${err.message ?? "Unknown error"}`);
      toast.error("CSV Upload Error.");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const uploadImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || loading) return;

    setLoading(true);
    setStatusText("Uploading…");

    const form = new FormData()
    form.append("file", file)
    form.append("projectId", project_id);

    const res = await fetch("/api/rasters/upload", {
      method: "POST",
      body: form
    })

    const data = await res.json();
    
    if (data) {
      toast.success("Image Uploaded Successfully!")
      toggleUploadModal();
      setImageUrl(data.url);
      setImagePath(data.path);
      setIsGeoreferencing(true);
      setStatusText("Uploading…");
    } else {
      toast.error("Image Upload Error");
      setStatusText("Image Upload Error.");
    }
    
    e.target.value = "";
    setLoading(true);
  }

  const disabledStyles =
    "opacity-50 cursor-not-allowed pointer-events-none";

  return (
    <div className="fixed inset-0 bg-black/30 text-black flex justify-center items-center">
      <div className="w-2/5 bg-white">
        <div className="w-full h-full relative p-4">
      {/* Close button */}
      <button
        disabled={loading}
        onClick={toggleUploadModal}
        className={`absolute top-2 right-4 transition-transform duration-200
          ${loading ? disabledStyles : "hover:scale-105 cursor-pointer"}`}
      >
        <i className="fa-solid fa-xmark" />
      </button>

      <div className="w-full h-full flex flex-col items-center space-y-2">
        <h2 className="text-xl font-bold">Upload Data</h2>
        <p className="text-center text-sm w-sm">
          Upload a GeoJSON / Shapefile ZIP, a CSV, or a PNG (requires georeferencing).
        </p>
        <p className="text-center text-xs text-gray-500">1MB File Size Limit (Will be increased later).</p>

        <div className="w-full mt-4 h-3/5 px-4 grid grid-cols-3 gap-4 text-8xl">
          {/* GeoJSON / SHP */}
          <label
            className={`relative inline-flex items-center justify-center gap-2
              border rounded-xl px-4 py-2 transition-all duration-200
              ${loading ? disabledStyles : "hover:text-gray-500 cursor-pointer"}`}
              htmlFor="upload-geo"
          >
            <span className="absolute -top-2 left-4 px-2 bg-white text-xs">
              GeoJSON / Shapefile zip
            </span>
            <i className="fa-solid fa-file" />
            <input
              id="upload-geo"
              type="file"
              disabled={loading}
              accept=".geojson,application/geo+json,.zip,application/zip"
              onChange={uploadGeoShp}
              className="hidden"
            />
          </label>

          {/* CSV with coordinates */}
          <label
            className={`relative inline-flex items-center justify-center gap-2
              border rounded-xl px-4 py-2 transition-all duration-200
              ${loading ? disabledStyles : "hover:text-gray-500 cursor-pointer"}`}
              htmlFor="upload-csv-coords"
          >
            <span className="absolute -top-2 left-4 px-2 bg-white text-xs">
              CSV (with coordinates)
            </span>
            <i className="fa-solid fa-file-csv" />
            <input
              id="upload-csv-coords"
              type="file"
              disabled={loading}
              accept=".csv"
              onChange={(e) => {
                setCSVType("coordinates");
                uploadCSV(e);
              }}
              className="hidden"
            />
          </label>

          {/* CSV without coords */}
          <label
            onClick={() => setIsCSV(true)}
            className={`relative inline-flex items-center justify-center gap-2
              border rounded-xl px-4 py-2 transition-all duration-200
              ${loading ? disabledStyles : "hover:text-gray-500 cursor-pointer"}`}
              htmlFor="upload-csv-no-coords">
            <span className="absolute -top-2 left-4 px-2 bg-white text-xs">
              CSV (without coordinates)
            </span>
            <i className="fa-solid fa-file-csv" />
          </label>

          {/* CSV with addresses */}
          <label
            className={`relative inline-flex items-center justify-center gap-2
              border rounded-xl px-4 py-2 transition-all duration-200
              ${loading ? disabledStyles : "hover:text-gray-500 cursor-pointer"}`}
              htmlFor="upload-csv-addresses"
          >
            <span className="absolute -top-2 left-4 px-2 bg-white text-xs">
              CSV (with addresses)
            </span>
            <i className="fa-solid fa-file-csv" />
            <input
              id="upload-csv-addresses"
              type="file"
              disabled={loading}
              accept=".csv"
              onChange={(e) => {
                setCSVType("addresses");
                uploadCSV(e);
              }}
              className="hidden"
            />
          </label>

          {/* PNG */}
          <label
            className={`relative inline-flex items-center justify-center gap-2
              border rounded-xl px-4 py-2 transition-all duration-200
              ${loading ? disabledStyles : "hover:text-gray-500 cursor-pointer"}`}
              htmlFor="uploadPNG"
          >
            <span className="absolute -top-2 left-4 px-2 bg-white text-xs">
              PNG Upload
            </span>
            <i className="fa-solid fa-file-image" />
            <input
              id="uploadPNG"
              type="file"
              disabled={loading}
              accept=".png,.jpg"
              onChange={uploadImage}
              className="hidden"
            />
          </label>

        </div>

        {/* Status */}
        <p className="text-xs text-gray-500">
          {loading ? "Processing file…" : statusText}
        </p>
      </div>
        </div>
      </div>

      {csvPreviewModal && csvData && (
        <CSVModal
          toggleCSVModal={toggleCSVModal}
          headers={csvData.headers}
          previewRows={csvData.previewRows}
          file={csvData.file}
          setStatus={setStatusText}
          toggleUploadModal={toggleUploadModal}
          getFeatureLayers={getFeatureLayers}
          csvType={csvType}
        />
      )}
    </div>
  );
};

type editModalProps = {
  selectedLayer: LayerType;
  setLayers: Dispatch<SetStateAction<FeatureLayerType[]>>;
  toggleEditModal: () => void;
  getFeatureLayers: () => void;
}

const EditModal = ({ selectedLayer, setLayers, toggleEditModal }: editModalProps) => {
  if (!selectedLayer) return null;

  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");

  // Input States
  const [layerName, setLayerName] = useState(selectedLayer.name);
  const [styleColor, setStyleColor] = useState(selectedLayer.style_color || "#000000");
  const [styleOpacity, setStyleOpacity] = useState(selectedLayer.style_opacity || 1);
  const [styleSize, setStyleSize] = useState(selectedLayer.style_size || 1);

  const handleUpdateLayer = async () => {
    setLoading(true);
    setStatusText("");

    try {
      await UpdateLayer({
        layer_id: selectedLayer.id,
        layer_name: layerName,
        order_index: selectedLayer.order_index,
        style_color: styleColor,
        style_opacity: styleOpacity,
        style_size: styleSize,
      });

      // Update local state immediately
      setLayers(prev =>
        prev.map(fl =>
          fl.layer.id === selectedLayer.id
            ? {
                ...fl,
                layer: {
                  ...fl.layer,
                  name: layerName,
                  style_color: styleColor,
                  style_opacity: styleOpacity,
                  style_size: styleSize,
                },
              }
            : fl
        )
      );

      toggleEditModal();
      toast.success("Layer Updated Successfully.");
    } catch (error) {
      console.error(error);
      toast.error("Layer Update Error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 text-black flex justify-center items-center">
      <div className="w-1/3 bg-white">
        <div className="w-full h-full relative p-6">
          {/* Close Button */}
          <button
            disabled={loading}
            onClick={toggleEditModal}
            className={`absolute top-4 right-4 transition-transform duration-200 cursor-pointer ${
              loading ? "cursor-not-allowed opacity-50" : "hover:scale-110"
            }`}
          >
            <i className="fa-solid fa-xmark text-lg" />
          </button>

          <div className="w-full p-4 flex flex-col space-y-4">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-center">Update Layer</h2>
              <h2 className="text-center">{selectedLayer.name}</h2>
            </div>

            {/* Layer Name */}
            <div className="flex flex-col">
              <label className="text-gray-500 text-sm mb-1">Layer Name</label>
              <input
                type="text"
                value={layerName}
                onChange={(e) => setLayerName(e.target.value)}
                placeholder="Layer Name"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 cursor-pointer"
              />
            </div>

            {/* Style Color */}
            <div className="flex flex-col">
              <label className="text-gray-500 text-sm mb-1">Style Color</label>
              <input
                type="color"
                value={styleColor}
                onChange={(e) => setStyleColor(e.target.value)}
                className="w-full h-10 border rounded-lg cursor-pointer"
              />
            </div>

            {/* Style Opacity */}
            <div className="flex flex-col">
              <label className="text-gray-500 text-sm mb-1">Opacity (0-1)</label>
              <input
                type="number"
                value={styleOpacity}
                min={0}
                max={1}
                step={0.1}
                onChange={(e) => setStyleOpacity(Number(e.target.value))}
                placeholder="Opacity"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 cursor-pointer"
              />
            </div>

            {/* Style Size */}
            <div className="flex flex-col">
              <label className="text-gray-500 text-sm mb-1">Size</label>
              <input
                type="number"
                value={styleSize}
                min={1}
                onChange={(e) => setStyleSize(Number(e.target.value))}
                placeholder="Size"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 cursor-pointer"
              />
            </div>

            {/* Status */}
            <p className="text-xs text-gray-500">{loading ? "Updating layer…" : statusText}</p>

            {/* Submit Button */}
            <button
              disabled={loading}
              onClick={handleUpdateLayer}
              className="w-full px-4 py-2 bg-gray-400 hover:bg-gray-600 text-white rounded-lg transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Updating..." : "Update Layer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

type sortableItemProps = {
  id: string,
  layer: FeatureLayerType,
  setSelectedLayer: Dispatch<SetStateAction<LayerType | null>>,
  setSelectedFeature: Dispatch<SetStateAction<FeatureType | null>>,
  openEditModal: (layer: LayerType) => void,
  deleteLayer: (layer_id: string) => void,
  deleteFeature: (feature_id: string) => void,
  toggleExpand: (layer_id: string) => void,
  toggleLVisible: (layer_id: string) => void,
  toggleFVisible: (layer_id: string, feature_id: string) => void,
}

const SortableItem = React.memo(({
  id,
  layer,
  setSelectedLayer,
  setSelectedFeature,
  openEditModal,
  deleteLayer,
  deleteFeature,
  toggleExpand,
  toggleLVisible,
  toggleFVisible,
}: sortableItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    padding: "10px",
    margin: "5px 0",
    background: "#eee",
    borderRadius: "4px",
    cursor: "grab",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
              <div
                key={layer.layer.id}
                onClick={() => {
                  setSelectedLayer(layer.layer);
                  setSelectedFeature(null);
                }}
                className="cursor-pointer"
              >
                <div className="flex justify-between items-center mb-2">
                  <div className="w-3/4 text-gray-800 flex items-center gap-2">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        
                      }}
                      className="hover:text-blue-500 transition-colors cursor-grab"
                      title="Drag"
                    >
                      <i className="fa-solid fa-bars" />
                    </button>
                    <input
                      type="checkbox"
                      checked={layer.layer.is_visible}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLVisible(layer.layer.id);
                      }}
                      className="w-4 h-4"
                    />
                    <p className="truncate ">{layer.layer.name}</p>
                  </div>

                  <div className="flex gap-2">
                    {/* Edit */}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        openEditModal(layer.layer);
                      }}
                      className="hover:text-blue-500 transition-colors cursor-pointer"
                      title="Edit"
                    >
                      <i className="fa-solid fa-pen" />
                    </button>

                    {/* Delete */}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        deleteLayer(layer.layer.id);
                      }}
                      className="hover:text-red-500 transition-colors cursor-pointer"
                      title="Delete"
                    >
                      <i className="fa-solid fa-trash" />
                    </button>

                    {/* Expand */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedLayer(layer.layer);
                        toggleExpand(layer.layer.id);
                        setSelectedFeature(null);
                      }}
                      className="text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                      <i className={`fa-solid ${layer.is_expanded ? "fa-angle-up" : "fa-angle-right"}`} />
                    </button>
                  </div>
                </div>

                {layer.is_expanded && layer.features.length > 0 && (
                  <div className="mt-2 border-t border-gray-300 pt-2 space-y-2">
                    {layer.features.map(f => (
                      <div
                        key={f.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFeature(f);
                          setSelectedLayer(layer.layer)
                        }}
                        className="flex justify-between items-center text bg-gray-300
                        rounded-lg px-3 py-2 hover:bg-gray-200
                        transition-colors duration-200 cursor-pointer"
                      >
                        <div className="flex items-center gap-2 w-3/4">
                          <input
                            type="checkbox"
                            checked={f.is_visible}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFVisible(layer.layer.id, f.id);
                            }}
                            className="w-4 h-4"
                          />
                          <p className="truncate">
                            <strong>ID:</strong> {f.id}
                          </p>
                        </div>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            deleteFeature(f.id);
                          }}
                          className="hover:text-red-500 transition-colors cursor-pointer"
                          title="Delete"
                        >
                          <i className="fa-solid fa-trash" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
    </div>
  )});

type ToolbarProps = {
  drawMode: boolean;
  toggleDrawMode: () => void;
  refreshData: () => void;
}

const ToolBarComponent = ({ drawMode, toggleDrawMode, refreshData } : ToolbarProps) => {
  const [profileDropDown, setProfileDropDown] = useState<boolean>(false); // Profile dropdown state
  const [uploadModal, setUploadModal] = useState<boolean>(false);
  const [editModal, setEditModal] = useState<boolean>(false);

  const mContext = useContext(MapContext); // Get Map Context
  if (!mContext) return;

  const [projects, setProjects] = useState<ProjectType[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [selectedProject, setSelectedProject] = mContext?.selectedProjectState;  // Get Selected Project
  const [selectedLayer, setSelectedLayer] = mContext.selectedLayerState; // Current Selected Layer
  const [selectedFeature, setSelectedFeature] = mContext.selectedFeatureState; // Current Selected Feature
  const [isGeoreferencing, _setIsGeoreferencing] = mContext.isGeoreferencingState;
  const [isCSV, _setIsCSV] = mContext.isCSVState;
  const [isLoadingLayers, setIsLoadingLayers] = useState(false);
  const [layers, setLayers] = mContext.featurelayerState; // Layer Data
  const [editModalData, setEditModalData] = useState<LayerType | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");

  const getAllProjects = async () => {
    setIsLoadingProjects(true);
    const data: ProjectType[] = await GetProjects();
    if (data) {
      setProjects(data);
      if (data.length === 1) setSelectedProject(data[0]);
    }
    setIsLoadingProjects(false);
  }

  useEffect(() => {
    getAllProjects();
  }, []);

  const createNewProject = async () => {
    try {
      const data = await CreateProject({ project_name: "New_Project" });
      if (data) setProjects(prev => [...prev, data]);;
      toast.success("Project Created Successfully!");
    } catch (error) {
      console.error(error);
      toast.error("Project Insert Error");
    }
  }
  const updateProject = async (project_id: string, project_name: string) => {
    try {
      const updatedProject = await UpdateProject({ project_id, project_name });
      if (!updatedProject) return;

      setProjects(prev =>
        prev.map(project =>
          project.id === project_id
            ? { ...project, ...updatedProject }
            : project
        )
      );

      toast.success("Project Updated Successfully!");
    } catch (error) {
      console.error(error);
      toast.error("Project Update Error");
    }
  };

  const deleteProject = async (project_id: string) => {
    try {
      await DeleteProject({ project_id: project_id });
      const filteredProjects = projects.filter(p => p.id !== project_id);
      setProjects(filteredProjects);
      setSelectedFeature(null);
      setSelectedLayer(null);
      getFeatureLayers();
      toast.success("Project Deleted Successfully!");
    } catch (error) {
      console.error(error);
      toast.error("Project Delete Error");
    }
  }

  const getFeatureLayers = async () => {
    if (!selectedProject) return;

    try {
      setIsLoadingLayers(true);

      refreshData();

      setUploadModal(false);
    } catch (error) {
      console.error(error);
      toast.error("Layer Fetch Error");
    } finally {
      setIsLoadingLayers(false);
    }
  };

  useEffect(() => {
    getFeatureLayers();
  }, [selectedProject, isGeoreferencing, isCSV]);

  const deleteLayer = async (layer_id: string) => {
    try {
      await DeleteLayer({ layer_id });

      // Update local state immediately
      setLayers(prev => prev.filter(fl => fl.layer.id !== layer_id));
      setSelectedLayer(null);
      setSelectedFeature(null);

      toast.success("Layer Deleted Successfully!");
    } catch (error) {
      console.error(error);
      toast.error("Layer Delete Error");
    }
  };

  const deleteFeature = async (feature_id: string) => {
    try {
      await DeleteFeature({ feature_id });

      // Update local state immediately
      setLayers(prev =>
        prev.map(fl => ({
          ...fl,
          features: fl.features.filter(f => f.id !== feature_id),
          layer: {
            ...fl.layer,
            // Layer visible if any features remain visible
            is_visible: fl.features.some(f => f.id !== feature_id ? f.is_visible : false)
          }
        }))
      );

      setSelectedFeature(null);
      toast.success("Feature Deleted Successfully!");
    } catch (error) {
      console.error(error);
      toast.error("Feature Delete Error");
    }
  };

  const toggleExpand = (layer_id: string) => { // Toggling Expandable Layers
    setLayers(prev => 
      prev.map(fl => {
        if (fl.layer.id !== layer_id) return fl;
        return { ...fl, is_expanded: !fl.is_expanded }
      })
    )
  }

  const toggleUploadModal = () => {
    if (!selectedProject) {
      toast.error("Please select a project.");
      return;
    }
    setUploadModal(prev => !prev);
  }

  const openEditModal = (layer: LayerType) => {
    setEditModalData(layer);
    setEditModal(true);
  };

  const toggleLVisible = (layer_id: string) => {
    setLayers(prev =>
      prev.map(fl => {
        if (fl.layer.id !== layer_id) return fl;

        const newVisibility = !fl.layer.is_visible;

        // Update features to match layer visibility
        const updatedFeatures = fl.features.map(f => ({ ...f, is_visible: newVisibility }));

        // Persist
        commitLayerVisibility({ layer_id, layer_isvisible: newVisibility });
        updateAllFeatureVisibility({ layer_id, visibility: newVisibility });

        // Update MapLibre immediately
        const map = mContext.mapRef.current;
        const mapLayerId = `layer-${layer_id}`;
        if (map && map.getLayer(mapLayerId)) {
          map.setLayoutProperty(mapLayerId, "visibility", newVisibility ? "visible" : "none");
        }

        return {
          ...fl,
          layer: { ...fl.layer, is_visible: newVisibility },
          features: updatedFeatures,
        };
      })
    );
  };

  const toggleFVisible = (layer_id: string, feature_id: string) => {
    setLayers(prev =>
      prev.map(fl => {
        if (fl.layer.id !== layer_id) return fl;

        let toggledVisible = false;

        const updatedFeatures = fl.features.map(f => {
          if (f.id !== feature_id) return f;

          toggledVisible = !f.is_visible;
          commitFeatureVisibility({ feature_id: f.id, feature_isvisible: toggledVisible });
          return { ...f, is_visible: toggledVisible };
        });

        const layerVisible = updatedFeatures.some(f => f.is_visible);
        if (layerVisible !== fl.layer.is_visible) {
          commitLayerVisibility({ layer_id, layer_isvisible: layerVisible });
        }

        return {
          ...fl,
          layer: { ...fl.layer, is_visible: layerVisible },
          features: updatedFeatures,
        };
      })
    );
  };

  const commitLayerVisibility = async ({ layer_id, layer_isvisible } : { layer_id: string, layer_isvisible: boolean }) => {
    try {
      await UpdateLayerVisibility({ layer_id, layer_isvisible });
    } catch (error) {
      console.error(error);
      toast.error("Layer Visibility Error.");
    }
  }

  const commitFeatureVisibility = async ({ feature_id, feature_isvisible } : { feature_id: string, feature_isvisible: boolean }) => {
    try {
      await UpdateFeatureVisibility({ feature_id, feature_isvisible });
    } catch (error) {
      console.error(error);
      toast.error("Layer Visibility Error.");
    }
  }

  const updateAllFeatureVisibility = async ({ layer_id, visibility } : { layer_id: string, visibility: boolean }) => {
    try {
      await UpdateAllLayerFeatureVisibility({ layer_id, visibility });
    } catch (error) {
      console.error(error);
      toast.error("Layer Visibility Error.");
    }
  }

  // Draggability
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = layers.findIndex((i) => i.layer.id === active.id);
      const newIndex = layers.findIndex((i) => i.layer.id  === over.id);
      const newItems = arrayMove(layers, oldIndex, newIndex).map((l, index) => ({
        ...l,
        layer: {
          ...l.layer,
          order_index: index + 1,
        },
      }));
      
      setLayers(newItems);
      setSelectedLayer(null);
      setSelectedFeature(null);

      const layersOrdered = newItems.map((l, index) => ({
        layer_id: l.layer.id,
        order_index: index + 1,
      }));
      updateLayerOrder(layersOrdered);
    }
  };

  const updateLayerOrder = async (layersOrdered: LayerOrderType[]) => {
      try {
        await UpdateLayerOrder({ layersOrdered });
      } catch (error) {
        console.error(error);
        toast.error("Order Update Error.");
      }
  }

  return (
    <div className="h-full">
      {/* Top bar */}
      <div className="relative flex justify-between items-center px-8 py-4 bg-gray-300 text-white">
        <h2 className="text-xl font-bold text-gray-600">Maplibre V2.0</h2>
        <button className="px-5 py-4 rounded-full bg-gray-400
        hover:bg-gray-600 hover:scale-105 transition-transform duration-200 cursor-pointer"
          onClick={() => setProfileDropDown(prev => !prev)}>
          <i className="fa-solid fa-user"></i>
        </button>

        {/* Dropdown */}
        {profileDropDown && (
          <div className="absolute z-50 -right-32 top-16 bg-gray-400 rounded-xl text-white flex flex-col">
            <button className="px-4 py-2 hover:bg-gray-200 rounded-t-xl hover:text-black transition-all duration-200
            ease-in-out cursor-pointer"
            onClick={toggleDrawMode}>{drawMode ? "Disable Draw Mode" : "Enable Draw Mode"}</button>
            <button className="px-4 py-2 hover:bg-gray-200 rounded-b-xl hover:text-black transition-all duration-200
            ease-in-out cursor-pointer">Sign Out</button>
          </div>
        )}

      </div>
      
      <div className="m-8 space-y-8">
      {/* Project Window */}
      <div className="h-[200] border border-gray-400 rounded-xl relative">
        <h2 className="absolute -top-3 left-4 bg-white text-gray-600 px-4 font-bold">
          Project Manager
        </h2>

        {/* Create Project */}
        <button
          onClick={createNewProject}
          className="absolute -top-4 right-8 bg-gray-400
            hover:bg-gray-600 hover:scale-105 text-white
            transition-all duration-200 ease-in-out
            cursor-pointer px-3 py-1 rounded-lg font-bold"
        >
          <i className="fa-solid fa-plus" />
        </button>

        <div className="max-h-[85%] overflow-y-auto my-8 mx-4 flex flex-col space-y-2 text-sm">
          {isLoadingProjects ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              Loading Projects...
            </div>
          ) : projects.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              No projects available
            </div>
          ) : (
            projects.map(project => {
              const isEditing = editingProjectId === project.id;

              return (
                <div
                  key={project.id}
                  onClick={() => !isEditing && setSelectedProject(project)}
                  className={`bg-gray-100 rounded-xl shadow-sm hover:shadow-md
                    transition-shadow duration-300 p-4 cursor-pointer
                    ${selectedProject?.id === project.id ? "border-2 border-blue-400" : ""}`}
                >
                  <div className="flex justify-between items-center gap-3">
                    {/* Name / Input */}
                    <div className="flex-1">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editingProjectName}
                          onChange={e => setEditingProjectName(e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-full px-2 py-1 rounded border border-gray-400
                            focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                      ) : (
                        <p className="truncate">{project.name}</p>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2 text-gray-600">
                      {isEditing ? (
                        <>
                          {/* Save */}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              updateProject(project.id, editingProjectName);
                              setEditingProjectId(null);
                            }}
                            className="hover:text-green-600 transition-colors cursor-pointer"
                            title="Save"
                          >
                            <i className="fa-solid fa-check" />
                          </button>

                          {/* Discard */}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              setEditingProjectId(null);
                              setEditingProjectName("");
                            }}
                            className="hover:text-red-500 transition-colors cursor-pointer"
                            title="Discard"
                          >
                            <i className="fa-solid fa-xmark" />
                          </button>
                        </>
                      ) : (
                        <>
                          {/* Edit */}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              setEditingProjectId(project.id);
                              setEditingProjectName(project.name);
                            }}
                            className="hover:text-blue-500 transition-colors cursor-pointer"
                            title="Edit"
                          >
                            <i className="fa-solid fa-pen" />
                          </button>

                          {/* Delete */}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              deleteProject(project.id);
                            }}
                            className="hover:text-red-500 transition-colors cursor-pointer"
                            title="Delete"
                          >
                            <i className="fa-solid fa-trash" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Layer Window */}
      <div className="h-[400] border border-gray-400 rounded-xl relative">
        <h2 className="absolute -top-3 left-4 bg-white text-gray-600 px-4 font-bold">
          Layer Manager
        </h2>

        {/* Upload Button */}
        <button className="absolute -top-4 right-8 bg-gray-400 
          hover:bg-gray-600 hover:scale-105 text-white transition-all duration-200
          ease-in-out cursor-pointer px-3 py-1 rounded-lg font-bold" onClick={toggleUploadModal}>
          <i className="fa-solid fa-arrow-up-from-bracket"></i>
        </button>

        <div className="max-h-9/10 overflow-y-auto my-8 mx-4 flex flex-col space-y-2 text-sm">

          {isLoadingLayers ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              Loading Layers...
            </div>
          ) : layers.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              No layers available
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={layers.map((i) => i.layer.id)} strategy={verticalListSortingStrategy}>
                {layers.map((layer) => (
                  <SortableItem 
                    key={layer.layer.id}
                    id={layer.layer.id}
                    layer={layer}
                    setSelectedLayer={setSelectedLayer}
                    setSelectedFeature={setSelectedFeature}
                    openEditModal={openEditModal}
                    deleteLayer={deleteLayer}
                    deleteFeature={deleteFeature}
                    toggleExpand={toggleExpand}
                    toggleLVisible={toggleLVisible}
                    toggleFVisible={toggleFVisible}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}

        </div>
      </div>

      {/* Selection Details */}
      <div className="h-[200] border border-gray-400 rounded-xl relative">
        <h2 className="absolute -top-3 left-4 bg-white text-gray-600 px-4 font-bold">
          Selection Details
        </h2>
        <button
          className="absolute -top-4 right-8 bg-gray-400
            hover:bg-gray-600 hover:scale-105 text-white transition-all duration-200
            ease-in-out cursor-pointer px-3 py-1 rounded-lg"
          onClick={() => {
            setSelectedFeature(null);
            setSelectedLayer(null);
          }}
        >
          Clear
        </button>
        <div className="h-full overflow-y-auto mx-1 flex flex-col space-y-4 p-4 bg-white rounded-lg text-sm">
          {selectedFeature ? (
            <div className="space-y-2 mt-2">
              {Object.entries(selectedFeature).map(([key, value]) => (
                <div
                  key={key}
                  className="flex gap-2 items-start bg-gray-50 p-2 rounded-md border border-gray-200"
                >
                  <strong className="text-gray-800">{key}:</strong>
                  <span className="text-gray-600 break-all">
                    {typeof value === "object"
                      ? JSON.stringify(value, null, 2)
                      : value.toString()}
                  </span>
                </div>
              ))}
            </div>
          ) : selectedLayer ? (
            <div className="space-y-2 mt-2">
              {Object.entries(selectedLayer).map(([key, value]) => (
                <div
                  key={key}
                  className="flex gap-2 items-start bg-gray-50 p-2 rounded-md border border-gray-200"
                >
                  <strong className="text-gray-800">{key}:</strong>
                  <span className="text-gray-600 break-all">
                    {typeof value === "object"
                      ? JSON.stringify(value, null, 2)
                      : value?.toString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 italic">
              No Selection.
            </div>
          )}
        </div>
      </div>

    </div>

      {uploadModal && 
        <ModalPortal>
          <UploadModal toggleUploadModal={toggleUploadModal} project_id={selectedProject?.id} getFeatureLayers={getFeatureLayers} />
        </ModalPortal>}
      {editModal && editModalData && 
        <ModalPortal>
          <EditModal selectedLayer={editModalData} setLayers={setLayers} toggleEditModal={() => setEditModal(false)} getFeatureLayers={getFeatureLayers} />
        </ModalPortal>}
    </div>
  )
}

export default ToolBarComponent