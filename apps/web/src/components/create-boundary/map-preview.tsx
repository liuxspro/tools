import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LonLat } from "@/lib/geo";
import type { Rings } from "@/lib/preview";

const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

type SourceData = Parameters<GeoJSONSource["setData"]>[0];

const EMPTY_COLLECTION = {
  type: "FeatureCollection",
  features: [],
} as unknown as SourceData;

function closedRing(points: LonLat[]): LonLat[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, first];
}

interface MapPreviewProps {
  polygons: Rings[];
  fitToken: number;
}

function collect_points(polygons: Rings[]): LonLat[] {
  return polygons.flatMap((rings) => rings.flat());
}

export function MapPreview({ polygons, fitToken }: MapPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const lastFitToken = useRef(-1);
  const lastFitKey = useRef("");

  useEffect(() => {
    let disposed = false;
    let instance: MapLibreMap | null = null;
    let cleanupObserver: (() => void) | null = null;

    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (disposed || !containerRef.current) return;

      maplibregl.setWorkerUrl(workerUrl);

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            esri: {
              type: "raster",
              tiles: [TILE_URL],
              tileSize: 256,
              maxzoom: 19,
              attribution: "Esri, Maxar, Earthstar Geographics",
            },
          },
          layers: [{ id: "esri", type: "raster", source: "esri" }],
        },
        center: [104, 35],
        zoom: 3.2,
        minZoom: 2,
        maxZoom: 19,
        attributionControl: { compact: true },
      });
      instance = map;

      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right",
      );
      map.addControl(
        new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }),
        "bottom-right",
      );

      map.on("load", () => {
        map.addSource("boundary", { type: "geojson", data: EMPTY_COLLECTION });
        map.addLayer({
          id: "boundary-fill",
          type: "fill",
          source: "boundary",
          paint: { "fill-color": "#2563eb", "fill-opacity": 0.1 },
        });
        map.addLayer({
          id: "boundary-line",
          type: "line",
          source: "boundary",
          paint: { "line-color": "#dc2626", "line-width": 2 },
        });
        map.resize();
        setReady(true);
      });

      map.on("error", (event) => {
        console.error("[map]", event.error ?? event);
      });

      const observer = new ResizeObserver(() => map.resize());
      observer.observe(containerRef.current);
      cleanupObserver = () => observer.disconnect();

      mapRef.current = map;
    })();

    return () => {
      disposed = true;
      cleanupObserver?.();
      instance?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const source = map.getSource("boundary") as GeoJSONSource | undefined;
    if (!source) return;

    const usable = polygons.filter((rings) => rings[0]?.length >= 3);
    if (usable.length === 0) {
      source.setData(EMPTY_COLLECTION);
      // 清空后重置，下一次有数据时必定重新定位
      lastFitKey.current = "";
      return;
    }

    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiPolygon",
            coordinates: usable.map((rings) => rings.map(closedRing)),
          },
        },
      ],
    } as unknown as SourceData);

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of collect_points(usable)) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }

    // 包围盒变化时重新定位，否则保持用户的平移/缩放
    const key = [minLon, minLat, maxLon, maxLat]
      .map((value) => value.toFixed(7))
      .join(",");
    if (fitToken !== lastFitToken.current || key !== lastFitKey.current) {
      lastFitToken.current = fitToken;
      lastFitKey.current = key;
      map.fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        { padding: 64, duration: 600, maxZoom: 18 },
      );
    }
  }, [polygons, ready, fitToken]);

  return <div ref={containerRef} className="h-full w-full" />;
}
