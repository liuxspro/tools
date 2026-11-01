/** 判断单元格是否为有效数字 */
export function is_number(cell: string | undefined): boolean {
  const value = cell?.trim() ?? "";
  return value !== "" && Number.isFinite(Number(value));
}

/**
 * 切分一行单元格
 *
 * 支持逗号、制表符（Word 表格复制）、分号、竖线；
 * 显式分隔符切不出 2 列以上时退化为空白分隔。
 */
export function split_cells(line: string): string[] {
  const parts = line.split(/[\t,;|]/).map((cell) => cell.trim());
  if (parts.length >= 2) {
    return parts;
  }
  return line.trim().split(/\s+/);
}

/**
 * 取一行的坐标对（第 2、3 列）
 *
 * 只有 2 列时返回 null —— 调用方应先用 `normalize_csv_columns` 补序号。
 */
export function parse_pair(line: string): [number, number] | null {
  const cells = split_cells(line);
  if (cells.length < 3 || cells[1] === "" || cells[2] === "") {
    return null;
  }
  const a = Number(cells[1]);
  const b = Number(cells[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  return [a, b];
}

/**
 * 两列数据补一列序号
 *
 * 从 Excel / 全站仪导出的坐标常只有 X、Y 两列，而解析按「第 2、3 列」取坐标，
 * 所以这里统一补一列序号；其余情况原样返回，交给正常解析报错。
 *
 * 首行不是数字时视为标题行，保留原列名并补一个「编号」列。
 */
export function normalize_csv_columns(text: string): string {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return text;
  }

  const rows = lines.map(split_cells);
  if (!rows.every((cells) => cells.length === 2)) {
    return text;
  }

  const has_header = !(is_number(rows[0][0]) && is_number(rows[0][1]));
  let seq = 0;

  return rows
    .map((cells, index) => {
      if (has_header && index === 0) {
        return `编号,${cells[0]},${cells[1]}`;
      }
      seq += 1;
      return `${seq},${cells[0]},${cells[1]}`;
    })
    .join("\n");
}

/** 缺带号的投影坐标默认使用的 3 度带带号 */
export const DEFAULT_ZONE = 39;

/** 整数部分的位数（忽略正负号） */
function integer_digits(cell: string): number {
  const value = cell.trim().replace(/^[+-]/, "");
  const [integer] = value.split(".");
  return integer?.length ?? 0;
}

/**
 * 给缺带号的投影坐标补带号
 *
 * 约定：北坐标（Y）为 7 位整数，东坐标（X）补带号后为 8 位。
 * 只有 6 位的东坐标才补带号，已经含带号、或不像投影坐标的行原样返回；
 * 一旦发生修改，整份文本统一重写成逗号分隔，避免分隔符混杂。
 */
function apply_zone(
  text: string,
  zone: number,
): { text: string; applied: boolean } {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return { text, applied: false };
  }

  const rows = lines.map(split_cells);
  const has_header = !is_number(rows[0][1]) || !is_number(rows[0][2]);
  let applied = false;

  const out = rows.map((cells, index) => {
    if ((has_header && index === 0) || cells.length < 3) {
      return cells.join(",");
    }

    let x = cells[1].trim();
    let y = cells[2].trim();
    // 首列是 7 位 → 是北坐标，与东坐标交换
    if (integer_digits(cells[1]) === 7) {
      x = cells[2].trim();
      y = cells[1].trim();
    }
    if (integer_digits(x) === 6) {
      x = `${zone}${x}`;
      applied = true;
    }
    return [cells[0], x, y, ...cells.slice(3)].join(",");
  });

  return applied
    ? { text: out.join("\n"), applied: true }
    : { text, applied: false };
}

/**
 * 网页端的 CSV 归一化
 *
 * 1. 两列补序号（`normalize_csv_columns`）
 * 2. 缺带号的投影坐标按给定带号补全
 */
export function normalize_csv(
  text: string,
  zone: number = DEFAULT_ZONE,
): { text: string; zone_applied: boolean } {
  const with_columns = normalize_csv_columns(text);
  const zoned = apply_zone(with_columns, zone);
  return { text: zoned.text, zone_applied: zoned.applied };
}
