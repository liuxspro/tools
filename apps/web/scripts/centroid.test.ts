import assert from "node:assert/strict";
import { test } from "node:test";
import { centroid_of } from "../src/lib/centroid.ts";

type Point = [number, number];
/** 外环在首位，后续为洞 */
type Polygon = Point[][];

function near(actual: number | undefined, expected: number): void {
  assert.ok(actual !== undefined, `缺少坐标，期望 ${expected}`);
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `实际 ${actual}，期望 ${expected}`,
  );
}

test("正方形 → 几何中心", () => {
  const center = centroid_of([[[[0, 0], [2, 0], [2, 2], [0, 2]]]]);
  assert.ok(center);
  near(center[0], 1);
  near(center[1], 1);
});

test("首尾未闭合与闭合的结果一致", () => {
  const open = centroid_of([[[[0, 0], [2, 0], [2, 2], [0, 2]]]]);
  const closed = centroid_of([[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]]);
  assert.ok(open && closed);
  near(open[0], closed[0]);
  near(open[1], closed[1]);
});

test("带孔洞 → 扣掉内环面积", () => {
  const polygons: Polygon[] = [[
    [[0, 0], [4, 0], [4, 4], [0, 4]],
    [[1, 1], [1, 3], [3, 3], [3, 1]],
  ]];
  const center = centroid_of(polygons);
  assert.ok(center);
  near(center[0], 2);
  near(center[1], 2);
});

test("两个等面积多边形 → 面积加权平均", () => {
  const polygons: Polygon[] = [
    [[[0, 0], [2, 0], [2, 2], [0, 2]]],
    [[[10, 10], [12, 10], [12, 12], [10, 12]]],
  ];
  const center = centroid_of(polygons);
  assert.ok(center);
  near(center[0], 6);
  near(center[1], 6);
});

test("面积不等时偏向大多边形", () => {
  const polygons: Polygon[] = [
    [[[0, 0], [4, 0], [4, 4], [0, 4]]], // 面积 16，质心 (2,2)
    [[[10, 10], [11, 10], [11, 11], [10, 11]]], // 面积 1，质心 (10.5,10.5)
  ];
  const center = centroid_of(polygons);
  assert.ok(center);
  // (2*16 + 10.5*1) / 17 = 2.5
  near(center[0], 2.5);
  near(center[1], 2.5);
});

test("三角形质心", () => {
  const center = centroid_of([[[[0, 0], [4, 0], [0, 4]]]]);
  assert.ok(center);
  near(center[0], 4 / 3);
  near(center[1], 4 / 3);
});

test("共线退化 → null", () => {
  assert.equal(centroid_of([[[[0, 0], [1, 1], [2, 2]]]]), null);
});

test("空输入 → null", () => {
  assert.equal(centroid_of([]), null);
  assert.equal(centroid_of([[]]), null);
});

test("实际地块：10 点经纬度", () => {
  const polygons: Polygon[] = [[[
    [118.744815, 34.092357],
    [118.745308, 34.094175],
    [118.745558, 34.094757],
    [118.747009, 34.094464],
    [118.746691, 34.093265],
    [118.746418, 34.092251],
    [118.746160, 34.092104],
    [118.745875, 34.092157],
    [118.745365, 34.092253],
    [118.744908, 34.092339],
  ]]];
  const center = centroid_of(polygons);
  assert.ok(center);
  // 界面展示保留 6 位
  assert.equal(center[0].toFixed(6), "118.745914");
  assert.equal(center[1].toFixed(6), "34.093412");
});
