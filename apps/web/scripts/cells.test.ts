import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_ZONE,
  normalize_csv,
  normalize_csv_columns,
  split_cells,
} from "../src/lib/cells.ts";

const TWO_COLUMN_TAB = [
  "3759243.435\t39478915.304",
  "3759249.432\t39478914.593",
  "3759271.080\t39479003.653",
].join("\n");

test("两列 + 制表符 → 补序号", () => {
  assert.equal(
    normalize_csv_columns(TWO_COLUMN_TAB),
    [
      "1,3759243.435,39478915.304",
      "2,3759249.432,39478914.593",
      "3,3759271.080,39479003.653",
    ].join("\n"),
  );
});

test("两列 + 逗号 / 空格 / 分号 → 补序号", () => {
  const expected = [
    "1,3759243.435,39478915.304",
    "2,3759249.432,39478914.593",
    "3,3759271.080,39479003.653",
  ].join("\n");

  assert.equal(
    normalize_csv_columns(TWO_COLUMN_TAB.replace(/\t/g, ",")),
    expected,
  );
  assert.equal(
    normalize_csv_columns(TWO_COLUMN_TAB.replace(/\t/g, "   ")),
    expected,
  );
  assert.equal(
    normalize_csv_columns(TWO_COLUMN_TAB.replace(/\t/g, ";")),
    expected,
  );
});

test("两列 + 标题行 → 保留列名", () => {
  assert.equal(
    normalize_csv_columns("Y\tX\n3759243.435\t39478915.304"),
    "编号,Y,X\n1,3759243.435,39478915.304",
  );
});

test("忽略空行，序号连续", () => {
  const input = "\n3759243.435\t39478915.304\n\n3759249.432\t39478914.593\n\n";
  assert.equal(
    normalize_csv_columns(input),
    "1,3759243.435,39478915.304\n2,3759249.432,39478914.593",
  );
});

test("三列数据原样返回", () => {
  const text = "编号,X,Y\n1,39478915.304,3759243.435";
  assert.equal(normalize_csv_columns(text), text);
});

test("列数不一致时原样返回（交给解析报错）", () => {
  const text = "1,39478915.304,3759243.435\n39478914.593\t3759249.432";
  assert.equal(normalize_csv_columns(text), text);
});

test("空输入原样返回", () => {
  assert.equal(normalize_csv_columns(""), "");
  const blank = "  \n  ";
  assert.equal(normalize_csv_columns(blank), blank);
});

test("实际两列数据（19 行）", () => {
  const rows = [
    ["3759243.435", "39478915.304"],
    ["3759249.432", "39478914.593"],
    ["3759271.080", "39479003.653"],
    ["3759271.252", "39479004.361"],
    ["3759158.074", "39479027.424"],
    ["3759157.632", "39479024.988"],
    ["3759150.322", "39479026.171"],
    ["3759149.003", "39479016.522"],
    ["3759139.513", "39478973.380"],
    ["3759135.789", "39478954.614"],
    ["3759135.382", "39478954.604"],
    ["3759121.026", "39478954.514"],
    ["3759119.503", "39478954.504"],
    ["3759120.286", "39478932.211"],
    ["3759120.850", "39478919.365"],
    ["3759121.265", "39478919.387"],
    ["3759129.765", "39478919.852"],
    ["3759131.010", "39478930.279"],
    ["3759150.672", "39478927.456"],
  ];
  const input = rows.map((row) => row.join("\t")).join("\n");
  const output = normalize_csv_columns(input).split("\n");

  assert.equal(output.length, 19);
  assert.equal(output[0], "1,3759243.435,39478915.304");
  assert.equal(output[18], "19,3759150.672,39478927.456");
});

test("split_cells 支持多种分隔符", () => {
  assert.deepEqual(split_cells("a\tb"), ["a", "b"]);
  assert.deepEqual(split_cells("a, b"), ["a", "b"]);
  assert.deepEqual(split_cells("a   b"), ["a", "b"]);
  assert.deepEqual(split_cells("a;b|c"), ["a", "b", "c"]);
});

// ── 缺带号坐标 ─────────────────────────────────────────────────

test("缺带号：Y 列在前（两列）→ 补序号 + 补带号 + 换序", () => {
  const result = normalize_csv("3759243.435\t547228.491");
  assert.equal(result.text, "1,39547228.491,3759243.435");
  assert.equal(result.zone_applied, true);
});

test("缺带号：X 列在前（两列）→ 补序号 + 补带号", () => {
  const result = normalize_csv("547228.491\t3759243.435");
  assert.equal(result.text, "1,39547228.491,3759243.435");
  assert.equal(result.zone_applied, true);
});

test("缺带号：三列数据直接补带号", () => {
  const result = normalize_csv("1,547228.491,3759243.435");
  assert.equal(result.text, "1,39547228.491,3759243.435");
  assert.equal(result.zone_applied, true);
});

test("缺带号：按指定带号补全", () => {
  const result = normalize_csv("1,547228.491,3759243.435", 40);
  assert.equal(result.text, "1,40547228.491,3759243.435");
});

test("缺带号：标题行保留，小数位不丢", () => {
  const result = normalize_csv(
    "编号,X,Y\n1,547228.5,3759243.435\n2,547228.491,3759249.432",
  );
  assert.equal(
    result.text,
    "编号,X,Y\n1,39547228.5,3759243.435\n2,39547228.491,3759249.432",
  );
  assert.equal(result.zone_applied, true);
});

test("已含带号 → 原样返回", () => {
  const text = "1,39547228.491,3759243.435";
  const result = normalize_csv(text);
  assert.equal(result.text, text);
  assert.equal(result.zone_applied, false);
});

test("经纬度 → 原样返回", () => {
  const text = "编号,经度,纬度\n1,117.51307,34.307738";
  const result = normalize_csv(text);
  assert.equal(result.text, text);
  assert.equal(result.zone_applied, false);
});

test("两列且已含带号 → 只补序号，列序交给后续解析处理", () => {
  const result = normalize_csv("3759243.435\t39547228.491");
  assert.equal(result.text, "1,3759243.435,39547228.491");
  assert.equal(result.zone_applied, false);
});

test("默认带号为 39", () => {
  assert.equal(DEFAULT_ZONE, 39);
});
