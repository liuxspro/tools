import { DEFAULT_ZONE, normalize_csv, parse_pair } from "./cells";
import {
  cgcsToLonLat,
  isInsideChina,
  type LonLat,
  normalizeLonLat,
} from "./geo";

export type CoordinateMode = "lonlat" | "projected";

export interface CsvParseResult {
  /** 经纬度点，仅用于地图展示 */
  points: LonLat[];
  mode: CoordinateMode | null;
  zone: number | null;
  error: string | null;
  rowCount: number;
  /** 坐标本身缺带号，已按界面上的 DH 补全 */
  zoneInferred: boolean;
}

const EMPTY: CsvParseResult = {
  points: [],
  mode: null,
  zone: null,
  error: null,
  rowCount: 0,
  zoneInferred: false,
};

const intDigits = (value: number) =>
  Math.trunc(Math.abs(value)).toString().length;

/**
 * 解析 CSV，产出用于地图展示的经纬度点。
 *
 * @param text 坐标文本
 * @param zone 坐标缺带号时使用的带号（来自界面的 DH）
 */
export function parseCsvPoints(
  text: string,
  zone: number = DEFAULT_ZONE,
): CsvParseResult {
  const normalized = normalize_csv(text, zone);
  const lines = normalized.text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return EMPTY;

  const has_header = parse_pair(lines[0]) === null;
  const rows = has_header ? lines.slice(1) : lines;

  const points: LonLat[] = [];
  let mode: CoordinateMode | null = null;
  let detected_zone: number | null = null;
  let error: string | null = null;
  let rowCount = 0;

  rows.forEach((line, index) => {
    const pair = parse_pair(line);
    if (!pair) {
      error ??= `第 ${
        index + (has_header ? 2 : 1)
      } 行不是有效的坐标行（需要 3 列：编号、X、Y）`;
      return;
    }
    rowCount += 1;

    try {
      if (mode === null) {
        mode = pair[0] < 200 ? "lonlat" : "projected";
      }

      if (mode === "lonlat") {
        const point = normalizeLonLat(pair[0], pair[1]);
        if (!isInsideChina(point)) {
          error ??= "经纬度超出中国范围，请检查列顺序与数值";
        }
        points.push(point);
        return;
      }

      let [x, y] = pair;
      if (intDigits(x) === 7) {
        [x, y] = [y, x];
      }
      if (intDigits(x) !== 8) {
        throw new Error("X 缺失带号");
      }
      const currentZone = Number(String(Math.trunc(x)).slice(0, 2));
      const point = cgcsToLonLat(x, y);
      detected_zone = currentZone;
      points.push(point);
    } catch (caught) {
      error ??= caught instanceof Error ? caught.message : String(caught);
    }
  });

  return {
    points,
    mode,
    zone: detected_zone,
    error,
    rowCount,
    zoneInferred: normalized.zone_applied,
  };
}
