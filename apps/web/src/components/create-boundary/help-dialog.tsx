import { type ReactNode, useEffect, useRef, useState } from "react";
import { CircleHelp, ExternalLink, X } from "lucide-react";

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

const CSV_LONLAT = `编号,经度,纬度
1,117.513070,34.307738
2,117.513274,34.309178
3,117.514937,34.309049
4,117.514722,34.305380`;

const CSV_PROJECTED = `编号,X,Y
1,39547228.491,3797916.479
2,39547246.449,3798076.324
3,39547399.598,3798062.844
4,39547381.907,3797655.744`;

const SURVEY_SYSTEM_URL = "http://114.251.10.109/page/landuserlogin.html";

export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <CircleHelp className="size-3.5" />
        使用说明
      </button>
      <HelpDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function Section(
  { title, children }: { title: string; children: ReactNode },
) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="text-xs font-semibold tracking-tight">{title}</h3>
      <div className="mt-1.5 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
      {children}
    </pre>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
      {children}
    </code>
  );
}

/** 用反引号标记需要高亮的片段，避免 JSX 换行产生的多余空格 */
function Text({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? <Key key={index}>{part}</Key> : part
      )}
    </>
  );
}

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
    >
      <div
        className="absolute inset-0 bg-foreground/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
          <h2 id="help-title" className="text-sm font-semibold">使用说明</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Section title="支持的数据">
            <ul className="list-disc space-y-1 pl-4">
              <li>
                <Text text="`CSV`：每行 3 列（编号、X、Y），首行可以是标题行，也可以直接是数据（会自动识别）。" />
              </li>
              <li>
                <Text text="分隔符支持逗号、制表符、分号、空格；从 Word 表格复制的坐标可直接粘贴。" />
              </li>
              <li>
                <Text text="只有 X、Y 两列时，会自动补一列序号。" />
              </li>
              <li>
                <Text text="`KML / KMZ`：WGS84 经纬度，支持 Polygon、MultiPolygon、LineString、MultiLineString（含孔洞）；只有 Point 的文件无法生成边界。" />
              </li>
              <li>
                <Text text="可一次选择多个文件（CSV / KML / KMZ 可混选），会合并成同一个地块边界。" />
              </li>
            </ul>
          </Section>

          <Section title="CSV 坐标格式">
            <p>
              <Text text="`两列顺序可以互换`，工具会按数值自动判断哪一列是 X。经纬度小于 200，会自动投影到 CGCS2000 3 度带；投影坐标需为 8 位且前两位是带号（25~45）。" />
            </p>
            <p>
              <Text text="`首尾坐标不必相同`，缺省时会自动闭合。" />
            </p>
            <p>
              <Text text="投影坐标不带带号时，按「地块信息」里的带号补全（默认 39）；改带号会实时重新投影。" />
            </p>
            <p className="pt-1 font-medium text-foreground">经纬度</p>
            <Code>{CSV_LONLAT}</Code>
            <p className="pt-1 font-medium text-foreground">
              投影坐标（X 含带号）
            </p>
            <Code>{CSV_PROJECTED}</Code>
          </Section>

          <Section title="地块信息">
            <p>
              <Text text="地块名称、地块代码、行政区名称、行政区代码为必填项。" />
            </p>
            <p>
              <Text text="用地面积和带号留空时，按合并后的多边形自动计算。" />
            </p>
          </Section>

          <Section title="输出文件">
            <p>
              <Text text="生成 `阶段+地块代码.zip`，内含 CGCS2000 3 度带投影的 Shapefile 五件套（`.shp` `.shx` `.dbf` `.prj` `.cpg`）。所有数据只在本机浏览器中处理，不会上传。" />
            </p>
            <p>
              <Text text="生成时可选择保存位置；浏览器不支持时直接下载到默认目录。" />
            </p>
          </Section>

          <Section title="相关链接">
            <a
              href={SURVEY_SYSTEM_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-foreground underline underline-offset-4 hover:text-primary"
            >
              全国建设用地土壤环境管理信息系统
              <ExternalLink className="size-3" />
            </a>
          </Section>
        </div>
      </div>
    </div>
  );
}
