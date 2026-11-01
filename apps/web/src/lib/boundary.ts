import {
  csv_to_shp,
  type Fields,
  files_to_shp,
  get_kml_from_kmz,
  kml_to_shp,
  make_boundary_zip,
} from "@jsr/liuxspro__create-boundary";

export {
  csv_to_shp,
  files_to_shp,
  get_kml_from_kmz,
  kml_to_shp,
  make_boundary_zip,
};
export type { Fields };

export type ShpResult = Awaited<ReturnType<typeof csv_to_shp>>;

/** 把库抛出的英文/内部错误补充成可操作的提示 */
export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/缺失带号|位数不足8位|没有带号/.test(message)) {
    return `${message}。投影坐标的 X 需为 8 位（前两位为带号 25~45），也可以直接使用经纬度坐标。`;
  }
  if (/带号不在范围内/.test(message)) {
    return `${message}。3 度带带号应在 25~45 之间。`;
  }
  if (/经度不在中国范围内/.test(message)) {
    return `${message}。请检查经纬度列的数值与顺序。`;
  }
  if (/点数据/.test(message)) {
    return `${message}。KML 中只有点要素，无法生成面状边界，请导出 Polygon 或 LineString。`;
  }
  if (/未检测到多边形数据/.test(message)) {
    return `${message}。请确认 KML 中包含 Polygon、LineString 等面/线要素。`;
  }
  if (/未找到 \.kml 文件/.test(message)) {
    return `${message}。KMZ 压缩包内需要有 .kml 文件（通常是 doc.kml）。`;
  }
  if (/不是有效的 ZIP 文件/.test(message)) {
    return `${message}。请确认文件确实是导出后的 KMZ，而不是改名得到的。`;
  }
  return message;
}

export type SaveStatus = "saved" | "downloaded" | "cancelled";

export interface SaveResult {
  status: SaveStatus;
  /** 实际文件名（另存为时可能被用户改过） */
  name: string;
  size: number;
}

interface SaveFileHandle {
  readonly name: string;
  createWritable(): Promise<{
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
  }>;
}

type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<SaveFileHandle>;

/** File System Access API 尚未进入 lib.dom，做最小本地声明 */
function get_save_file_picker(): SaveFilePicker | null {
  const picker = (globalThis as { showSaveFilePicker?: SaveFilePicker })
    .showSaveFilePicker;
  return typeof picker === "function" ? picker : null;
}

function download_zip(data: Uint8Array, filename: string): void {
  const blob = new Blob([data as unknown as BlobPart], {
    type: "application/zip",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * 保存生成的 ZIP
 *
 * 优先弹出「另存为」对话框（File System Access API），
 * 浏览器不支持或调用失败时退回普通的 a 标签下载。
 */
export async function save_zip(
  data: Uint8Array,
  filename: string,
): Promise<SaveResult> {
  const size = data.byteLength;
  const picker = get_save_file_picker();

  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: "Shapefile ZIP",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      return { status: "saved", name: handle.name, size };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { status: "cancelled", name: filename, size };
      }
      // 权限、跨域 iframe 等情况：退回下载
    }
  }

  download_zip(data, filename);
  return { status: "downloaded", name: filename, size };
}
