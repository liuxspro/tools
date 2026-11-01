import proj4 from "proj4";
import { get_cgcs2000_wkt } from "@jsr/liuxspro__geo";

export type LonLat = [number, number];

/** 与 @liuxspro/geo 的约定保持一致 */
export const LON_MIN = 73.62;
export const LON_MAX = 135;
export const LAT_MIN = 18;
export const LAT_MAX = 54;

const intDigits = (value: number) =>
  Math.trunc(Math.abs(value)).toString().length;

/**
 * CGCS2000 投影坐标（X 含 8 位带号）转经纬度。
 * 与 @liuxspro/create-boundary 中 transform.ts 的实现一致，用于地图展示。
 */
export function cgcsToLonLat(x: number, y: number): LonLat {
  if (intDigits(x) !== 8) {
    throw new Error("X 缺失带号");
  }
  const zone = Number(String(Math.trunc(x)).slice(0, 2));
  const wkt = get_cgcs2000_wkt(zone);
  const [lon, lat] = proj4(wkt).inverse([x, y]);
  return [lon, lat];
}

/** 经纬度列顺序纠正（仅用于展示，库内会自行处理） */
export function normalizeLonLat(a: number, b: number): LonLat {
  const aIsLon = a >= LON_MIN && a <= LON_MAX;
  const bIsLon = b >= LON_MIN && b <= LON_MAX;
  const aIsLat = a >= LAT_MIN && a <= LAT_MAX;
  const bIsLat = b >= LAT_MIN && b <= LAT_MAX;

  if (aIsLon && bIsLat) return [a, b];
  if (bIsLon && aIsLat) return [b, a];
  return [a, b];
}

export function isInsideChina([lon, lat]: LonLat): boolean {
  return lon >= LON_MIN - 1 && lon <= LON_MAX + 1 && lat >= LAT_MIN - 1 &&
    lat <= LAT_MAX + 1;
}
