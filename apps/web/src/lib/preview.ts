import { parse_kml_content } from "@jsr/liuxspro__create-boundary";
import { centroid_of } from "./centroid";
import { parseCsvPoints } from "./csv";
import type { LonLat } from "./geo";

export type SourceFormat = "csv" | "kml";

/** 一个多边形的环：外环在首位，后续为洞 */
export type Rings = LonLat[][];

export interface PreviewData {
  /** WGS84 多边形，供地图直接渲染 */
  polygons: Rings[];
  /** 坐标点数量（闭合点不计入） */
  pointCount: number;
  /** 状态栏展示的坐标类型 */
  label: string;
  error: string | null;
  /** 面积质心（经度, 纬度），无有效多边形时为 null */
  center: LonLat | null;
  /** 坐标本身缺带号，已按界面上的 DH 补全 */
  zoneInferred: boolean;
}

export const EMPTY_PREVIEW: PreviewData = {
  polygons: [],
  pointCount: 0,
  label: "地图预览",
  error: null,
  center: null,
  zoneInferred: false,
};

function count_points(polygons: Rings[]): number {
  let total = 0;
  for (const rings of polygons) {
    for (const ring of rings) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      const closed = first && last && first[0] === last[0] &&
        first[1] === last[1];
      total += ring.length - (closed ? 1 : 0);
    }
  }
  return total;
}

function preview_csv(text: string, zone: number): PreviewData {
  const parsed = parseCsvPoints(text, zone);
  const polygons: Rings[] = parsed.points.length >= 3 ? [[parsed.points]] : [];
  return {
    polygons,
    pointCount: parsed.rowCount,
    label: parsed.mode === "lonlat"
      ? "经纬度坐标"
      : parsed.mode === "projected"
      ? `投影坐标 · 带号 ${parsed.zone}`
      : "坐标",
    error: parsed.error,
    center: centroid_of(polygons),
    zoneInferred: parsed.zoneInferred,
  };
}

function preview_kml(text: string): PreviewData {
  const parsed = parse_kml_content(text);
  const polygons: Rings[] = parsed
    .map((polygon) =>
      polygon.rings
        .map((ring) => ring.points.map(([lon, lat]) => [lon, lat] as LonLat))
        .filter((ring) => ring.length >= 3)
    )
    .filter((rings) => rings.length > 0);

  return {
    polygons,
    pointCount: count_points(polygons),
    label: polygons.length > 1 ? `KML · ${polygons.length} 个多边形` : "KML",
    error: polygons.length > 0 ? null : "KML 文件中未检测到多边形数据",
    center: centroid_of(polygons),
    zoneInferred: false,
  };
}

/**
 * 解析上传或粘贴的坐标数据，产出地图预览模型。
 * 生成 Shapefile 以核心库为准，这里只做预览。
 *
 * @param format 数据格式
 * @param text 原始文本
 * @param zone 投影坐标缺带号时使用的带号
 */
export function preview_source(
  format: SourceFormat,
  text: string,
  zone: number,
): PreviewData {
  if (!text.trim()) return EMPTY_PREVIEW;
  try {
    return format === "kml" ? preview_kml(text) : preview_csv(text, zone);
  } catch (error) {
    return {
      ...EMPTY_PREVIEW,
      label: format === "kml" ? "KML" : "坐标",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 合并多个文件的预览结果
 *
 * 多边形与点数相加，错误取第一个，标签按文件数汇总。
 */
export function combine_previews(parts: PreviewData[]): PreviewData {
  if (parts.length === 0) return EMPTY_PREVIEW;
  const polygons = parts.flatMap((part) => part.polygons);
  const pointCount = parts.reduce((sum, part) => sum + part.pointCount, 0);
  const error = parts.find((part) => part.error)?.error ?? null;
  const label = parts.length === 1
    ? parts[0].label
    : `${parts.length} 个文件 · ${polygons.length} 个多边形`;
  return {
    polygons,
    pointCount,
    label,
    error,
    center: centroid_of(polygons),
    zoneInferred: parts.some((part) => part.zoneInferred),
  };
}

/** 按内容判断是 KML 还是 CSV，用于粘贴文本时自动识别 */
export function sniff_format(text: string): SourceFormat {
  const head = text.trimStart();
  return head.startsWith("<") ? "kml" : "csv";
}
