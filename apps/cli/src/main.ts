#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  type BoundaryFile,
  files_to_shp,
  make_boundary_zip,
} from "@liuxspro/create-boundary";
import type { Fields } from "@liuxspro/create-boundary";

// 库未导出 Stage 类型别名，从函数签名推导，随库契约自动同步
type Stage = Parameters<typeof make_boundary_zip>[0];
type InputFormat = "csv" | "kml" | "kmz";

const STAGES = ["初步调查", "详细调查"] as const;

/** 退出码：0 成功，1 数据/几何/读写失败，2 参数错误 */
const EXIT_RUNTIME = 1;
const EXIT_USAGE = 2;

/** 小于该面积（m²）视为退化几何 */
const MIN_AREA = 1;

/** 参数阶段错误，统一按退出码 2 处理 */
class UsageError extends Error {}

// [参数名, DBF 字段, 中文名]
const REQUIRED_FIELDS = [
  ["dkmc", "DKMC", "地块名称"],
  ["dkdm", "DKDM", "地块代码"],
  ["xzqmc", "XZQMC", "行政区名称"],
  ["xzqdm", "XZQDM", "行政区代码"],
] as const;

/** 文本类 DBF 字段名（用于宽度校验） */
type TextField = "DKMC" | "DKDM" | "XZQMC" | "XZQDM" | "SCDW" | "BZ";

/** DBF 文本字段宽度（字节），与库中字段定义一致；中文按 UTF-8 占 3 字节 */
const TEXT_FIELD_WIDTHS: ReadonlyArray<
  readonly [flag: string, field: TextField, width: number]
> = [
  ["dkmc", "DKMC", 254],
  ["dkdm", "DKDM", 100],
  ["xzqmc", "XZQMC", 100],
  ["xzqdm", "XZQDM", 12],
  ["scdw", "SCDW", 254],
  ["bz", "BZ", 254],
];

/** DKDM 会进入 ZIP 内部文件名，不能含路径分隔符等字符 */
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/;

const HELP =
  `用法: create-boundary <file...> --dkmc <地块名称> --dkdm <地块代码>
                --xzqmc <行政区名称> --xzqdm <行政区代码> [选项]

根据地块边界文件生成 Shapefile 并打包为 ZIP。
包装 @liuxspro/create-boundary 的 files_to_shp + make_boundary_zip。

参数:
  <file...>           边界文件路径，可传多个，合并为一个地块边界。
                      传 "-" 从标准输入读取（自动识别格式），可与文件混用。
                       .csv  每行 3 列：编号, X, Y；首行可为标题行，
                             也可直接是数据。分隔符支持逗号、制表符、
                             分号、空格。X/Y 可为经纬度(小于 200，自动
                             投影) 或 CGCS2000 投影坐标(8 位含带号)。
                       .kml  WGS84 经纬度，支持 Polygon / MultiPolygon /
                             LineString / MultiLineString。
                       .kmz  KML 的 ZIP 压缩包（内含 .kml 文件）。
                      文本文件按 UTF-8 读取，失败时回退 GB18030。

必填项:
  --dkmc <名称>        地块名称 (DKMC)
  --dkdm <代码>        地块代码 (DKDM)
  --xzqmc <名称>       行政区名称 (XZQMC)
  --xzqdm <代码>       行政区代码 (XZQDM)

选项:
  -s, --stage <阶段>      调查阶段: 初步调查 | 详细调查 (默认: 初步调查)
  -o, --output <文件>     输出 ZIP 路径 (默认: 与第一个输入文件同目录，
                          命名为 {阶段}{DKDM}.zip)
  --ydmj <面积>           用地面积(m²)，须为正数；不填则按多边形自动计算
  --dh <带号>             带号，不填则按坐标自动计算；与坐标带号冲突时报错
  --scrq <日期>           生产日期，严格 YYYY-MM-DD，不填则默认今天
  --scdw <单位>           生产单位 (SCDW)
  --bz <备注>             备注 (BZ)
  --json                  输出一行 JSON 供脚本消费
  --dry-run               只校验不写文件
  -v, --version           输出版本号
  -h, --help              显示帮助

退出码:
  0  成功
  1  数据 / 几何 / 读写失败
  2  参数错误（选项、必填项、格式）
`;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 多行错误逐行加前缀，方便脚本按前缀过滤 */
function printError(message: string): void {
  for (const line of message.split("\n")) {
    console.error(`[create-boundary] ${line}`);
  }
}

/**
 * 把 `--ydmj -5` 这类负数值合并成 `--ydmj=-5`
 *
 * 否则 parseArgs 会把 `-5` 当成未知选项，报 “argument is ambiguous”。
 */
function normalizeArgv(argv: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (
      arg.startsWith("--") && !arg.includes("=") && next !== undefined &&
      /^-\d/.test(next)
    ) {
      out.push(`${arg}=${next}`);
      index += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function parseCliArgs() {
  try {
    return parseArgs({
      args: normalizeArgv(process.argv.slice(2)),
      options: {
        stage: { type: "string", short: "s" },
        output: { type: "string", short: "o" },
        dkmc: { type: "string" },
        dkdm: { type: "string" },
        xzqmc: { type: "string" },
        xzqdm: { type: "string" },
        ydmj: { type: "string" },
        dh: { type: "string" },
        scrq: { type: "string" },
        scdw: { type: "string" },
        bz: { type: "string" },
        json: { type: "boolean" },
        "dry-run": { type: "boolean" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });
  } catch (err) {
    throw new UsageError(errorMessage(err));
  }
}

function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

function validateStage(value: string | undefined): Stage {
  const stage = value ?? "初步调查";
  if (!isStage(stage)) {
    throw new UsageError(
      `无效的 --stage: ${stage}（可选: ${STAGES.join(" | ")}）`,
    );
  }
  return stage;
}

function validateYdmj(value: string | undefined): number | null {
  if (value === undefined) return null;
  const area = Number(value);
  if (!Number.isFinite(area)) {
    throw new UsageError(`参数 --ydmj 需要为数字，收到: ${value}`);
  }
  if (area <= 0) {
    throw new UsageError(`用地面积必须为正数，收到: ${value}`);
  }
  return area;
}

function validateDh(value: string | undefined): number | null {
  if (value === undefined) return null;
  const zone = Number(value);
  if (!Number.isInteger(zone) || zone < 25 || zone > 45) {
    throw new UsageError(`参数 --dh 需为 25~45 的整数，收到: ${value}`);
  }
  return zone;
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new UsageError(`参数 --scrq 需为 YYYY-MM-DD 格式，收到: ${value}`);
  }
  const date = new Date(`${value}T00:00:00`);
  // 用本地日期回写比对，避免时区导致 ISO 日期偏移一天
  const normalized = Number.isNaN(date.getTime())
    ? ""
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${
      String(date.getDate()).padStart(2, "0")
    }`;
  if (normalized !== value) {
    throw new UsageError(`参数 --scrq 不是有效日期: ${value}`);
  }
  return date;
}

/** 取必填参数值，同时收窄类型（缺失 / 空串已在 main 中统一提示） */
function requiredOption(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === "") {
    throw new UsageError(`缺少必填参数 --${flag}`);
  }
  return value.trim();
}

/** 一次性列出所有缺失或为空的必填项 */
function validateRequired(
  values: Record<string, string | boolean | undefined>,
): void {
  const problems: string[] = [];
  for (const [flag, key, label] of REQUIRED_FIELDS) {
    const value = values[flag];
    if (value === undefined) {
      problems.push(`  --${flag} <${label}> (${key})`);
    } else if (typeof value === "string" && value.trim() === "") {
      problems.push(`  --${flag} <${label}> (${key}) 不能为空`);
    }
  }
  if (problems.length > 0) {
    throw new UsageError(`缺少必填参数:\n${problems.join("\n")}`);
  }
}

/**
 * 提前校验文本字段字节长度，报出具体参数名。
 * 否则要等到库写 DBF 时才抛 “String length exceeds limit: N”，不点名字段。
 */
function validateTextWidths(fields: Fields): void {
  for (const [flag, field, width] of TEXT_FIELD_WIDTHS) {
    const bytes = Buffer.byteLength(fields[field] ?? "", "utf8");
    if (bytes > width) {
      throw new UsageError(
        `--${flag} 超出 ${field} 字段宽度（最多 ${width} 字节，当前 ${bytes} 字节；中文占 3 字节）`,
      );
    }
  }
}

/** 针对坐标/几何解析的常见错误补充可操作提示 */
function parseErrorHint(message: string): string {
  if (message.includes("X 缺失带号")) {
    return "\n提示: 投影坐标的 X 需含带号（整数部分 8 位，如 39547228.491）；\n" +
      "      经纬度请输入小于 200 的 WGS84 经纬度值";
  }
  if (message.includes("带号不在范围内")) {
    return "\n提示: 3 度带带号应为 25~45，即投影坐标 X 的前两位";
  }
  if (message.includes("点数据")) {
    return "\n提示: KML 中只有点要素，无法生成面状边界，请导出 Polygon 或 LineString";
  }
  if (message.includes("未检测到多边形数据")) {
    return "\n提示: 请确认 KML/KMZ 中包含 Polygon、LineString 等面/线要素";
  }
  if (message.includes("未找到 .kml 文件")) {
    return "\n提示: KMZ 压缩包内需要包含 .kml 文件（通常是 doc.kml）";
  }
  return "";
}

/** 根据扩展名判断输入格式 */
function formatFromName(name: string): InputFormat {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "txt") return "csv";
  if (ext === "kml") return "kml";
  if (ext === "kmz") return "kmz";
  throw new UsageError(`不支持的文件类型: ${name}（支持 .csv / .kml / .kmz）`);
}

/** 标准输入没有文件名，按内容判断格式 */
function sniffFormat(bytes: Uint8Array): InputFormat {
  // ZIP 魔数 “PK\x03\x04”
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "kmz";
  const head = decodeText(bytes).trimStart();
  return head.startsWith("<") ? "kml" : "csv";
}

/** 优先按 UTF-8 解码，失败时回退 GB18030（Excel / 旧系统导出的中文 CSV） */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(bytes);
    } catch {
      return new TextDecoder().decode(bytes);
    }
  }
}

function splitCells(line: string): string[] {
  const parts = line.split(/[\t,;|]/).map((cell) => cell.trim());
  return parts.length >= 2 ? parts : line.split(/\s+/);
}

function isNumberCell(cell: string | undefined): boolean {
  const value = cell?.trim() ?? "";
  return value !== "" && Number.isFinite(Number(value));
}

/**
 * CSV 列数检查
 *
 * 核心库按「第 2、3 列」取坐标，两列数据会被当成表头，静默算出 NaN 面积。
 * 这里提前拦截，给出点名到行的错误。
 */
function checkCsvColumns(text: string, source: string): void {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error(`${source} 中没有坐标数据`);
  }

  const first = splitCells(lines[0]);
  const hasHeader = !(isNumberCell(first[1]) && isNumberCell(first[2]));
  const rows = hasHeader ? lines.slice(1) : lines;

  if (rows.length === 0) {
    throw new Error(`${source} 只有标题行，没有坐标数据`);
  }

  rows.forEach((line, index) => {
    const count = splitCells(line).length;
    if (count < 3) {
      throw new Error(
        `${source} 第 ${index + (hasHeader ? 2 : 1)} 行只有 ${count} 列，` +
          `CSV 需要 3 列：编号, X, Y`,
      );
    }
  });

  // 库的环点校验会把自动闭合的点算进去（2 个点报“当前只有 3 个”），这里先给准确点数
  if (rows.length < 3) {
    throw new Error(
      `${source} 坐标点不足 3 个（当前 ${rows.length} 个），无法构成多边形`,
    );
  }
}

/**
 * 从 SHP 主文件读出所有点的东坐标，收集带号前缀
 *
 * 布局：0-99 文件头，108 shape type，144 NumParts，148 NumPoints，
 * 152 起是 Parts 数组，之后是 (x, y) 双精度点。
 */
function zonesFromShp(shp: Uint8Array): Set<number> {
  const zones = new Set<number>();
  if (shp.byteLength < 152) return zones;

  const view = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  const shapeType = view.getInt32(108, true);
  if (shapeType !== 5) return zones;

  const numParts = view.getInt32(144, true);
  const numPoints = view.getInt32(148, true);
  let offset = 152 + numParts * 4;

  for (let index = 0; index < numPoints; index += 1) {
    if (offset + 16 > view.byteLength) break;
    const x = view.getFloat64(offset, true);
    if (Number.isFinite(x)) {
      zones.add(Math.trunc(Math.abs(x) / 1_000_000));
    }
    offset += 16;
  }
  return zones;
}

async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  // 复制一份，确保 byteOffset 为 0（fflate 解压依赖）
  return new Uint8Array(Buffer.concat(chunks));
}

async function packageVersion(): Promise<string> {
  for (const rel of ["../package.json", "./package.json"]) {
    try {
      const pkg = JSON.parse(
        await readFile(new URL(rel, import.meta.url), "utf8"),
      ) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // 继续尝试下一个候选路径
    }
  }
  return "unknown";
}

function describeReadError(err: unknown, file: string): string {
  const code = (err as { code?: string }).code;
  if (code === "ENOENT") return `读取 ${file} 失败: 文件不存在`;
  if (code === "EACCES") return `读取 ${file} 失败: 没有读取权限`;
  return `读取 ${file} 失败: ${errorMessage(err)}`;
}

function describeWriteError(err: unknown, file: string): string {
  const code = (err as { code?: string }).code;
  if (code === "ENOENT") return `写入 ${file} 失败: 输出目录不存在`;
  if (code === "EACCES") return `写入 ${file} 失败: 没有写入权限`;
  return `写入 ${file} 失败: ${errorMessage(err)}`;
}

interface LoadedFile {
  file: BoundaryFile;
  /** 第一个输入文件所在目录，作为默认输出目录 */
  dir: string;
}

async function loadFiles(sourceArgs: string[]): Promise<LoadedFile[]> {
  const loaded: LoadedFile[] = [];

  for (const arg of sourceArgs) {
    if (arg === "-") {
      const bytes = await readStdin();
      const format = sniffFormat(bytes);
      const name = `标准输入.${format}`;
      if (format === "kmz") {
        loaded.push({ file: { name, content: bytes }, dir: process.cwd() });
      } else {
        const text = decodeText(bytes);
        if (format === "csv") checkCsvColumns(text, name);
        loaded.push({ file: { name, content: text }, dir: process.cwd() });
      }
      continue;
    }

    const format = formatFromName(arg);
    let buffer: Uint8Array;
    try {
      buffer = new Uint8Array(await readFile(arg));
    } catch (err) {
      throw new Error(describeReadError(err, arg));
    }

    if (format === "kmz") {
      loaded.push({
        file: { name: arg, content: buffer },
        dir: path.dirname(arg),
      });
      continue;
    }

    const text = decodeText(buffer);
    if (format === "csv") checkCsvColumns(text, arg);
    loaded.push({ file: { name: arg, content: text }, dir: path.dirname(arg) });
  }

  return loaded;
}

interface Report {
  stage: Stage;
  ydmj: number;
  dh: number;
  output: string;
  bytes: number;
  dryRun: boolean;
  warnings: string[];
}

function report(
  result: Report,
  json: boolean,
  autoYdmj: boolean,
  autoDh: boolean,
): void {
  if (json) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: result.dryRun,
      stage: result.stage,
      ydmj: result.ydmj,
      dh: result.dh,
      output: result.output,
      bytes: result.bytes,
      warnings: result.warnings,
    }));
    return;
  }

  const autos: string[] = [];
  if (autoYdmj) autos.push(`YDMJ=${result.ydmj}`);
  if (autoDh) autos.push(`DH=${result.dh}`);
  if (autos.length > 0) console.log(`自动计算: ${autos.join(", ")}`);

  for (const warning of result.warnings) {
    console.warn(`[create-boundary] 警告: ${warning}`);
  }

  if (result.dryRun) {
    console.log(`校验通过（dry-run），未写入: ${result.output}`);
    return;
  }
  console.log(`已生成: ${result.output} (${result.bytes} 字节)`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseCliArgs();

  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.version) {
    console.log(await packageVersion());
    return;
  }

  // ── 参数阶段（退出码 2）────────────────────────────────
  if (positionals.length === 0) {
    throw new UsageError("缺少位置参数 <file...>（可用 - 从标准输入读取）");
  }
  if (positionals.filter((arg) => arg === "-").length > 1) {
    throw new UsageError("标准输入 - 只能出现一次");
  }

  validateRequired(values);

  const stage = validateStage(values.stage);
  const ydmjInput = validateYdmj(values.ydmj);
  const dhInput = validateDh(values.dh);
  const scrq = values.scrq === undefined ? new Date() : parseDate(values.scrq);
  const scdw = values.scdw ?? "";
  const bz = values.bz ?? "";

  const fieldsBase = {
    DKMC: requiredOption(values.dkmc, "dkmc"),
    DKDM: requiredOption(values.dkdm, "dkdm"),
    XZQMC: requiredOption(values.xzqmc, "xzqmc"),
    XZQDM: requiredOption(values.xzqdm, "xzqdm"),
    SCDW: scdw,
    BZ: bz,
  };

  if (INVALID_FILENAME_CHARS.test(fieldsBase.DKDM)) {
    throw new UsageError(
      `--dkdm 含文件名非法字符 ${INVALID_FILENAME_CHARS.source}（会写入 ZIP 内文件名），收到: ${fieldsBase.DKDM}`,
    );
  }

  validateTextWidths({
    ...fieldsBase,
    YDMJ: ydmjInput ?? 0,
    DH: dhInput ?? 39,
    SCRQ: scrq,
  });

  // ── 数据阶段（退出码 1）────────────────────────────────
  const loaded = await loadFiles(positionals);

  let boundary: Awaited<ReturnType<typeof files_to_shp>>;
  try {
    boundary = await files_to_shp(loaded.map((entry) => entry.file));
  } catch (err) {
    const message = errorMessage(err);
    throw new Error(`${message}${parseErrorHint(message)}`);
  }

  const { YDMJ: autoYDMJ, DH: autoDH, shp } = boundary;

  if (!Number.isFinite(autoYDMJ) || autoYDMJ < MIN_AREA) {
    throw new Error(
      `无法得到有效面积（YDMJ=${autoYDMJ}）。请检查坐标数据：` +
        `CSV 需要 3 列（编号, X, Y），且多边形不能是共线的退化图形`,
    );
  }

  const zones = zonesFromShp(shp.shp);
  if (zones.size > 1) {
    throw new Error(
      `坐标跨越多个 3 度带（${
        [...zones].sort((a, b) => a - b).join(", ")
      }），` +
        `无法生成单个边界文件；请拆分后分别生成`,
    );
  }
  if (dhInput !== null && zones.size === 1 && !zones.has(dhInput)) {
    throw new UsageError(
      `--dh ${dhInput} 与坐标自带带号 ${[...zones][0]} 冲突；` +
        `去掉 --dh，或改用正确的带号`,
    );
  }

  const YDMJ = ydmjInput ?? autoYDMJ;
  const DH = dhInput ?? autoDH;

  const fields: Fields = {
    ...fieldsBase,
    YDMJ,
    DH,
    SCRQ: scrq,
    SCDW: fieldsBase.SCDW === "" ? null : fieldsBase.SCDW,
    BZ: fieldsBase.BZ === "" ? null : fieldsBase.BZ,
  };

  let data: Uint8Array;
  try {
    data = await make_boundary_zip(stage, fields, shp);
  } catch (err) {
    throw new Error(`生成边界文件失败: ${errorMessage(err)}`);
  }

  const defaultDir = loaded[0]?.dir ?? process.cwd();
  const output = values.output ??
    path.join(defaultDir, `${stage}${fields.DKDM}.zip`);
  const dryRun = values["dry-run"] === true;

  if (!dryRun) {
    try {
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, data);
    } catch (err) {
      throw new Error(describeWriteError(err, output));
    }
  }

  report(
    {
      stage,
      ydmj: YDMJ,
      dh: DH,
      output,
      bytes: data.byteLength,
      dryRun,
      warnings: [],
    },
    values.json === true,
    ydmjInput === null,
    dhInput === null,
  );
}

const jsonMode = process.argv.includes("--json");

main().catch((err: unknown) => {
  const message = errorMessage(err);
  const code = err instanceof UsageError ? EXIT_USAGE : EXIT_RUNTIME;

  if (jsonMode) {
    console.error(JSON.stringify({ ok: false, code, error: message }));
  } else {
    printError(message);
    if (err instanceof UsageError) {
      console.error("[create-boundary] 运行 create-boundary --help 查看用法");
    }
  }
  process.exitCode = code;
});
