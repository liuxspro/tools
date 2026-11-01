import type { LonLat } from "./geo";

/** 一个环（已闭合或未闭合都可以） */
export type Ring = LonLat[];

/** 多个多边形，每个多边形是外环 + 可选内环 */
export type Polygons = Ring[][];

interface RingCentroid {
  /** 有向面积（用来加权，符号不参与计算） */
  area: number;
  x: number;
  y: number;
}

/** 环的面积与质心（鞋带公式） */
function ring_centroid(ring: Ring): RingCentroid {
  let twice_area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const cross = x0 * y1 - x1 * y0;
    twice_area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (twice_area === 0) {
    return { area: 0, x: 0, y: 0 };
  }
  return {
    area: twice_area / 2,
    x: cx / (3 * twice_area),
    y: cy / (3 * twice_area),
  };
}

/**
 * 多边形的面积质心（扣掉孔洞，多个多边形按面积加权）
 *
 * 与 @turf/center-of-mass 的结果一致，面积按经纬度平面计算，
 * 对单个地块足够精确。
 *
 * @param polygons 多边形列表，每个多边形第一个环是外环
 * @returns 质心坐标；没有有效面积时返回 null
 */
export function centroid_of(polygons: Polygons): LonLat | null {
  let total_area = 0;
  let sum_x = 0;
  let sum_y = 0;

  for (const rings of polygons) {
    const outer = rings[0];
    if (!outer || outer.length < 3) continue;

    const outer_centroid = ring_centroid(outer);
    let area = Math.abs(outer_centroid.area);
    let x = outer_centroid.x * area;
    let y = outer_centroid.y * area;

    for (const hole of rings.slice(1)) {
      if (hole.length < 3) continue;
      const hole_centroid = ring_centroid(hole);
      const hole_area = Math.abs(hole_centroid.area);
      area -= hole_area;
      x -= hole_centroid.x * hole_area;
      y -= hole_centroid.y * hole_area;
    }

    if (area <= 0) continue;
    total_area += area;
    sum_x += x;
    sum_y += y;
  }

  if (total_area === 0) return null;
  return [sum_x / total_area, sum_y / total_area];
}
