"use client";

import { useState, useContext } from "react";
import {
  GetParentPolygons,
  FeaturesWithinPolygon,
  FeaturesIntersectPolygon,
  FeaturesWithinDistance,
  CountFeaturesInPolygons,
} from "@/actions/spatialActions";
import { MapContext } from "@/context/MapContext";
import type { ProjectType } from "@/types/tableTypes";
import { toast } from "react-toastify";

type QueryType =
  | "Get Parent Polygons"
  | "Features Within Polygon"
  | "Features Intersect Polygon"
  | "Features Within Distance"
  | "Count Features in Polygons";

const QueryComponent = () => {
  const mContext = useContext(MapContext); // Get Map Context
  if (!mContext) return;

  const [selectedProjectState, _setSelectedProjectState] = mContext?.selectedProjectState;  // Get Selected Project
  const projectId = selectedProjectState?.id;

  const [selectedQuery, setSelectedQuery] = useState<QueryType | "">("");
  const [queryInputs, setQueryInputs] = useState<{ [key: string]: string }>({});
  const [queryResult, setQueryResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [queryType, setQueryType] = useState<"Prompt Query" | "Dropdown Query">("Prompt Query");

  const queryOptions: QueryType[] = [
    "Get Parent Polygons",
    "Features Within Polygon",
    "Features Intersect Polygon",
    "Features Within Distance",
    "Count Features in Polygons"
  ];

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQueryInputs(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleRunQuery = async () => {
    if (!projectId) {
      setError("No project selected.");
      toast.error("No project selected.");
      return;
    }

    setLoading(true);
    setError(null);
    setQueryResult(null);

    try {
      let result: any = null;

      switch (selectedQuery) {
        case "Get Parent Polygons":
          result = await GetParentPolygons(
            BigInt(queryInputs.featureId),
            projectId
          );
          break;

        case "Features Within Polygon":
          result = await FeaturesWithinPolygon(
            BigInt(queryInputs.polygonId),
            projectId
          );
          break;

        case "Features Intersect Polygon":
          result = await FeaturesIntersectPolygon(
            BigInt(queryInputs.polygonId),
            projectId
          );
          break;

        case "Features Within Distance":
          result = await FeaturesWithinDistance(
            BigInt(queryInputs.featureId),
            Number(queryInputs.distance),
            projectId
          );
          break;

        case "Count Features in Polygons":
          result = await CountFeaturesInPolygons(projectId);
          break;

        default:
          result = "No query selected.";
      }

      setQueryResult(result);
    } catch (err: any) {
      setError(err.message || "Error running query");
      toast.error(err.message || "Error running query");
    } finally {
      setLoading(false);
    }
  };

  const handleClearResult = () => {
    setQueryResult(null);
    setError(null);
  };

  const renderInputs = () => {
    switch (selectedQuery) {
      case "Get Parent Polygons":
        return (
          <input
            type="number"
            name="featureId"
            value={queryInputs.featureId || ""}
            onChange={handleInputChange}
            placeholder="Feature ID"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 cursor-pointer"
          />
        );

      case "Features Within Polygon":
      case "Features Intersect Polygon":
        return (
          <input
            type="number"
            name="polygonId"
            value={queryInputs.polygonId || ""}
            onChange={handleInputChange}
            placeholder="Polygon ID"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 cursor-pointer"
          />
        );

      case "Features Within Distance":
        return (
          <>
            <input
              type="number"
              name="featureId"
              value={queryInputs.featureId || ""}
              onChange={handleInputChange}
              placeholder="Feature ID"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 mb-2 cursor-pointer"
            />
            <input
              type="number"
              name="distance"
              value={queryInputs.distance || ""}
              onChange={handleInputChange}
              placeholder="Distance (meters)"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 cursor-pointer"
            />
          </>
        );

      case "Count Features in Polygons":
        return <p className="text-gray-500">No input required</p>;

      default:
        return null;
    }
  };

  return (
    <div className="h-full px-4 py-8">
      <div className="h-full relative mt-8">
        <div className="absolute -top-9 z-5 w-full space-x-1">
          <button className={` text-sm font-bold border-x border-t rounded-t-xl p-2 ${queryType === "Prompt Query" ? "bg-white" : "hover:bg-gray-200 transition-colors duration-200 ease-in-out cursor-pointer"}`}
            onClick={() => setQueryType("Prompt Query")}>
            Prompt Query
          </button>
          <button className={` text-sm font-bold border-x border-t rounded-t-xl p-2 ${queryType === "Dropdown Query" ? "bg-white" : "hover:bg-gray-200 transition-colors duration-200 ease-in-out cursor-pointer"}`}
            onClick={() => setQueryType("Dropdown Query")}>
            Dropdown Query
          </button>
        </div>

        {queryType === "Prompt Query" ? (
        <div className="space-y-8 px-2 py-4 border-t h-14/15">

        {/* Query Section */}
        <div className="relative border border-gray-400 rounded-xl p-4">
          <h2 className="absolute -top-3 left-4 bg-white px-4 text-gray-600 font-bold z-10">
            Query
          </h2>

          <div className="flex flex-col space-y-4 mt-4">
            <form>
            <textarea
              name="prompt"
              rows={5}
              placeholder="e.g. How many X are in riding Y?"
              className="w-full text-sm px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 mb-2 cursor-pointer"
            />

            {selectedQuery && (
              <button className="disabled self-start px-4 py-2 bg-gray-400 hover:bg-gray-600 text-white 
                rounded-lg transition-all duration-200 cursor-not-allowed">
                {loading ? "Running..." : "Run Query"}
              </button>
            )}
            </form>
          </div>
        </div>

        {/* Result Section */}
        <div className="relative border border-gray-400 rounded-xl h-7/10">
          <h2 className="absolute -top-3 left-4 bg-white px-4 text-gray-600 font-bold z-10">
            Result
          </h2>

          <button
            onClick={handleClearResult}
            className="absolute -top-4 right-4 px-3 py-1 bg-gray-400 hover:bg-gray-600 text-white rounded-lg transition-all duration-200 z-10 cursor-pointer"
          >
            Clear
          </button>

          <div className="h-24/25 p-4 mt-4 text-sm font-mono text-gray-400 whitespace-pre-wrap overflow-y-auto">
            Prompt Result.
          </div>
        </div>

        </div>
        ) : (
        <div className="space-y-8 px-2 py-4 border-t h-14/15">

        {/* Query Section */}
        <div className="relative border border-gray-400 rounded-xl p-4">
          <h2 className="absolute -top-3 left-4 bg-white px-4 text-gray-600 font-bold z-10">
            Query
          </h2>

          <div className="flex flex-col space-y-4 mt-4">
            <select
              value={selectedQuery}
              onChange={(e) => {
                setSelectedQuery(e.target.value as QueryType);
                setQueryInputs({});
                setQueryResult(null);
                setError(null);
              }}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 cursor-pointer"
            >
              <option value="">Select Query</option>
              {queryOptions.map(q => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>

            {/* Dynamic Inputs */}
            {selectedQuery && renderInputs()}

            {selectedQuery && (
              <button
                onClick={handleRunQuery}
                className="self-start px-4 py-2 bg-gray-400 hover:bg-gray-600 text-white rounded-lg transition-all duration-200 cursor-pointer"
              >
                {loading ? "Running..." : "Run Query"}
              </button>
            )}
          </div>
        </div>

        {/* Result Section */}
        <div className="relative border border-gray-400 rounded-xl h-7/10">
          <h2 className="absolute -top-3 left-4 bg-white px-4 text-gray-600 font-bold z-10">
            Result
          </h2>

          <button
            onClick={handleClearResult}
            className="absolute -top-4 right-4 px-3 py-1 bg-gray-400 hover:bg-gray-600 text-white rounded-lg transition-all duration-200 z-10 cursor-pointer"
          >
            Clear
          </button>

          <div className="h-24/25 p-4 mt-4 text-sm font-mono text-gray-700 whitespace-pre-wrap overflow-y-auto">
            {error && <span className="text-red-500">{error}</span>}
            {!error && !queryResult && <span className="text-gray-400">No results yet.</span>}
            {!error && queryResult && JSON.stringify(queryResult, null, 2)}
          </div>
        </div>

        </div>
        )}

      </div>
    </div>
  );
};

export default QueryComponent;