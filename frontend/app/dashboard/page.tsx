"use client"

import MapComponent from "@/components/mapComponent"
import QueryComponent from "@/components/queryComponent"
import ToolBarComponent from "@/components/toolBarComponent"
import { MapContext } from "@/context/MapContext"
import { useEffect, useRef, useState } from "react"
import { ProjectType, LayerType, FeatureType, FeatureLayerType } from "@/types/tableTypes";
import GeoRefComponent from "@/components/georefComponent"
import { toast } from "react-toastify"
import { CSVRow, GCPType, RasterBounds } from "@/types/gcpTypes"
import CsvComponent from "@/components/csvComponent"
import { GetProjectLayerFeatures } from "@/actions/layerActions"

export const EMPTY_GCPS: GCPType[] = Array.from({ length: 4 }, (_, i) => ({
  id: i + 1,
  px: null,
  py: null,
  lon: null,
  lat: null,
}));

const Dashboard = () => {
  // Toggle States
  const [toolBarOpen, setToolBarOpen] = useState<boolean>(true);
  const [queryOpen, setQueryOpen] = useState<boolean>(false);

  // Toggle Draw Mode
  const [drawMode, setDrawMode] = useState<boolean>(false);

  // Map Refs
  const mapRef = useRef(null);
  const drawRef = useRef(null);

  // Zoom & Coords
  const zoomState = useState(12);
  const coordsState = useState({ lng: 0, lat: 0 });

  // Data States
  const selectedProjectState = useState<ProjectType | null>(null);
  const selectedLayerState = useState<LayerType | null>(null);
  const selectedFeatureState = useState<FeatureType | null>(null);
  const featurelayerState = useState<FeatureLayerType[]>([]);
  const imageUrlState = useState<string | null>(null);
  const imagePathState = useState<string | null>(null);
  const isGeoreferencingState = useState<boolean>(false);
  const isCSVState = useState<boolean>(false);
  const gcpPathState = useState<GCPType[]>(EMPTY_GCPS);
  const selectedGcpPathState = useState<GCPType | null>(null); 
  const rasterUrlState = useState<string | null>(null);
  const rasterBounds = useState<RasterBounds | null>(null);
  const rasterVisibility = useState<boolean>(true);
  const rasterOpacity = useState<number>(1);
  const csvRows = useState<CSVRow[]>([]);

  const [selectedProject, _setSelectedProject] = selectedProjectState;
  const [_featureLayers, setFeatureLayers] = featurelayerState;
  const [_imageUrl, setImageUrl] = imageUrlState;
  const [imagePath, _setImagePath] = imagePathState;
  const [isGeoreferencing, setIsGeoreferencing] = isGeoreferencingState;
  const [isCSV, setIsCSV] = isCSVState;

  const toggleToolBarOpen = () => setToolBarOpen(prev => !prev);
  const toggleQueryComponent = () => setQueryOpen(prev => !prev);
  const toggleDrawMode = () => setDrawMode(prev => !prev);

  const cancelGeoRef = async () => {
    setIsGeoreferencing(false);
    setImageUrl(null);

    if (!imagePath) return;

    try {
      const res = await fetch("/api/rasters/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: imagePath }),
      });

      if (!res.ok) throw new Error("Delete failed");
    } catch (err) {
      toast.error("Georeference Cancel Error.");
      console.error(err);
    }
  };

  const cancelCSV = () => {
    setIsCSV(false);
  }

  useEffect(() => {
    if (isGeoreferencing === false) cancelGeoRef();
  }, [isGeoreferencing]);

  const refreshData = async () => {
    if (!selectedProject) return;
    const data: FeatureLayerType[] = await GetProjectLayerFeatures({ project_id: selectedProject.id });
    if (data) 
        setFeatureLayers(
          data.map(layer => ({
            ...layer,
            is_expanded: false
          }))
        );
  }

  return (
    <MapContext.Provider value={{ 
      mapRef, drawRef, zoomState, coordsState, selectedProjectState, selectedLayerState, selectedFeatureState, featurelayerState, isGeoreferencingState, 
      imageUrlState, imagePathState, gcpPathState, selectedGcpPathState, rasterUrlState, rasterBounds, rasterVisibility, rasterOpacity, csvRows, isCSVState
    }}>
      <div className="h-screen w-full text-black relative overflow-hidden">

        {/* Left Toolbar */}
        <div className={`absolute top-0 left-0 z-50 h-full w-125 bg-white shadow-2xl transition-transform duration-300
          ${!isGeoreferencing && !isCSV && toolBarOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <ToolBarComponent drawMode={drawMode} toggleDrawMode={toggleDrawMode} refreshData={refreshData} />
        </div>

        {/* Left Toggle Button */}
        {!isGeoreferencing && !isCSV && 
          <button
            className={`absolute top-3 z-50 text-2xl bg-gray-300 px-5 py-4 rounded-r-full
              hover:text-3xl transition-transform duration-300 ease-in-out
              ${toolBarOpen ? "left-125" : "left-0"}`}
            onClick={toggleToolBarOpen}
          >
            {toolBarOpen ? <i className="fa-solid fa-angle-left"></i> : <i className="fa-solid fa-wrench"></i>}
          </button>
        }

        {/* Map Component */}
        <div className="absolute inset-0 h-full">
          <MapComponent drawMode={drawMode} refreshData={refreshData} />
        </div>

        {/* Right Query Manager */}
        <div className={`absolute top-0 right-0 h-full w-100 bg-white shadow-2xl transition-transform duration-300
          ${!isGeoreferencing && !isCSV && queryOpen ? "translate-x-0" : "translate-x-full"}`}>
          <QueryComponent />
        </div>

        {/* Right Toggle Button */}
        {!isGeoreferencing && !isCSV && 
          <button
            className={`absolute top-3 z-50 text-2xl bg-white px-5 py-4 rounded-l-full
              hover:text-3xl transition-transform duration-300 ease-in-out
              ${queryOpen ? "right-100" : "right-0"}`}
            onClick={toggleQueryComponent}
          >
            {queryOpen ? <i className="fa-solid fa-angle-right"></i> : <i className="fa-solid fa-magnifying-glass"></i>}
          </button>
        }

        {/* Right Georeference Manager */}
        {isGeoreferencing &&
          <div className={`absolute top-0 right-0 h-full w-140 bg-white shadow-2xl transition-transform duration-300`}>
            <button
              onClick={cancelGeoRef}
              className={`absolute top-4 right-6 text-xl transition-transform duration-200 cursor-pointer`}>
              <i className="fa-solid fa-xmark" />
            </button>
            <GeoRefComponent cancelGeoRef={cancelGeoRef} />
          </div>
        }

        {/* Right CSV Manager */}
        {isCSV &&
          <div className={`absolute top-0 right-0 h-full w-140 bg-white shadow-2xl transition-transform duration-300`}>
            <button
              onClick={cancelCSV}
              className={`absolute top-4 right-6 text-xl transition-transform duration-200 cursor-pointer`}>
              <i className="fa-solid fa-xmark" />
            </button>
            <CsvComponent cancelCsv={cancelCSV} />
          </div>
        }


      </div>
    </MapContext.Provider>
  )
}

export default Dashboard
