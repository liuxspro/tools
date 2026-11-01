#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  type BoundaryFile,
  files_to_shp,
  make_boundary_zip,
} from "@liuxspro/create-boundary";
import type { Fields } from "@liuxspro/create-boundary";

// 库未导出 Stage 类型别名，从函数签名推导，随库契约自动同步
type Stage = Parameters<typeof make_boundary_zip>[0];

const STAGES = ["初步调查", "详细调查"] as const;

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

/** 支持的输入格式 */
type InputFormat = "csv" | "kml" | "kmz";

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
                             投影) 或 CGCS2000 投影坐标(X含带号)。
                       .kml  WGS84 经纬度，支持 Polygon / MultiPolygon /
                             LineString / MultiLineString。
                       .kmz  KML 的 ZIP 压缩包（内含 .kml 文件）。

必填项:
  --dkmc <名称>        地块名称 (DKMC)
  --dkdm <代码>        地块代码 (DKDM)
  --xzqmc <名称>       行政区名称 (XZQMC)
  --xzqdm <代码>       行政区代码 (XZQDM)

选项:
  -s, --stage <阶段>      调查阶段: 初步调查 | 详细调查 (默认: 初步调查)
  -o, --output <文件>     输出 ZIP 路径 (可选，不填时自动命名为 {阶段}{DKDM}.zip)
  --ydmj <面积>           用地面积(m²)，不填则按多边形自动计算
  --dh <带号>             带号，不填则按坐标自动计算
  --scrq <日期>           生产日期 (YYYY-MM-DD)，不填则默认今天
  --scdw <单位>           生产单位 (SCDW)
  --bz <备注>             备注 (BZ)
  -v, --version           输出版本号
  -h, --help              显示帮助
`;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

function parseNumber(value: string, flag: string): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`参数 --${flag} 需要为数字，收到: ${value}`);
  }
  return num;
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`参数 --scrq 需要为有效日期 (YYYY-MM-DD)，收到: ${value}`);
  }
  return date;
}

/** 取必填参数值，同时收窄类型（批量缺失提示已在 main 中处理） */
function requiredOption(value: string | undefined, flag: string): string {
  if (value === undefined) {
    throw new Error(`缺少必填参数 --${flag}`);
  }
  return value;
}

/** 根据扩展名判断输入格式 */
function formatFromName(name: string): InputFormat {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "txt") return "csv";
  if (ext === "kml") return "kml";
  if (ext === "kmz") return "kmz";
  throw new Error(`不支持的文件类型: ${name}（支持 .csv / .kml / .kmz）`);
}

/** 标准输入没有文件名，按内容判断格式 */
function sniffFormat(bytes: Uint8Array): InputFormat {
  // ZIP 魔数 “PK\x03\x04”
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "kmz";
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart();
  return head.startsWith("<") ? "kml" : "csv";
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

/**
 * 提前校验文本字段字节长度，报出具体参数名。
 * 否则要等到库写 DBF 时才抛 “String length exceeds limit: N”，不点名字段。
 */
function validateTextWidths(fields: Fields): void {
  for (const [flag, field, width] of TEXT_FIELD_WIDTHS) {
    const bytes = Buffer.byteLength(fields[field] ?? "", "utf8");
    if (bytes > width) {
      throw new Error(
        `--${flag} 超出 ${field} 字段宽度（最多 ${width} 字节，当前 ${bytes} 字节；中文占 3 字节）`,
      );
    }
  }
}

function parseCliArgs() {
  try {
    return parseArgs({
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
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });
  } catch (err) {
    console.error(`[create-boundary] ${errorMessage(err)}`);
    console.error("运行 create-boundary --help 查看用法");
    process.exit(2);
  }
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

  const sourceArgs = positionals;
  if (sourceArgs.length === 0) {
    console.error(HELP);
    process.exit(2);
  }
  if (sourceArgs.filter((arg) => arg === "-").length > 1) {
    throw new Error("标准输入 - 只能出现一次");
  }

  const missing = REQUIRED_FIELDS.filter(([flag]) =>
    values[flag] === undefined
  );
  if (missing.length > 0) {
    const list = missing.map(([flag, key, label]) =>
      `  --${flag} <${label}> (${key})`
    ).join("\n");
    console.error(`缺少必填参数:\n${list}`);
    console.error("运行 create-boundary --help 查看用法");
    process.exit(2);
  }

  const stageInput = values.stage ?? "初步调查";
  if (!isStage(stageInput)) {
    throw new Error(
      `无效的 --stage: ${stageInput}（可选: ${STAGES.join(" | ")}）`,
    );
  }
  const stage = stageInput;

  // 读取输入：文件按扩展名判断，标准输入按内容嗅探
  const files: BoundaryFile[] = [];
  for (const arg of sourceArgs) {
    if (arg === "-") {
      const bytes = await readStdin();
      const format = sniffFormat(bytes);
      files.push({
        name: `标准输入.${format}`,
        content: format === "kmz"
          ? bytes
          : new TextDecoder("utf-8").decode(bytes),
      });
      continue;
    }
    const format = formatFromName(arg);
    try {
      // KMZ 需保留二进制，文本格式按 UTF-8 读取
      files.push({
        name: arg,
        content: format === "kmz"
          ? new Uint8Array(await readFile(arg))
          : await readFile(arg, "utf8"),
      });
    } catch (err) {
      throw new Error(`读取 ${arg} 失败: ${errorMessage(err)}`);
    }
  }

  // 文件 → Shapefile，并得到由几何自动计算的面积与带号
  let boundary: Awaited<ReturnType<typeof files_to_shp>>;
  try {
    boundary = await files_to_shp(files);
  } catch (err) {
    const message = errorMessage(err);
    throw new Error(`${message}${parseErrorHint(message)}`);
  }
  const { YDMJ: autoYDMJ, DH: autoDH, shp } = boundary;
  const YDMJ = values.ydmj === undefined
    ? autoYDMJ
    : parseNumber(values.ydmj, "ydmj");
  const DH = values.dh === undefined ? autoDH : parseNumber(values.dh, "dh");

  // 字段全部解析为最终值后写入 DBF 并打包（内部文件名为 {阶段}{DKDM}）
  const fields: Fields = {
    DKMC: requiredOption(values.dkmc, "dkmc"),
    DKDM: requiredOption(values.dkdm, "dkdm"),
    XZQMC: requiredOption(values.xzqmc, "xzqmc"),
    XZQDM: requiredOption(values.xzqdm, "xzqdm"),
    YDMJ,
    DH,
    SCRQ: values.scrq === undefined ? new Date() : parseDate(values.scrq),
    SCDW: values.scdw ?? "",
    BZ: values.bz ?? "",
  };
  validateTextWidths(fields);

  let data: Uint8Array;
  try {
    data = await make_boundary_zip(stage, fields, shp);
  } catch (err) {
    throw new Error(`生成边界文件失败: ${errorMessage(err)}`);
  }

  const autos: string[] = [];
  if (values.ydmj === undefined) autos.push(`YDMJ=${YDMJ}`);
  if (values.dh === undefined) autos.push(`DH=${DH}`);
  if (autos.length > 0) console.log(`自动计算: ${autos.join(", ")}`);

  const out = values.output ?? `${stage}${fields.DKDM || ""}.zip`;
  await writeFile(out, data);
  console.log(`已生成: ${out} (${data.length} 字节)`);
}

main().catch((err: unknown) => {
  console.error(`[create-boundary] ${errorMessage(err)}`);
  process.exitCode = 1;
});
