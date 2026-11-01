import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  FileText,
  LoaderCircle,
  MapPin,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { MapPreview } from "./map-preview";
import {
  byteLength,
  type FieldKey,
  type FormValues,
  type Stage,
  STAGES,
  validateFields,
} from "@/lib/validation";
import { DEFAULT_ZONE, normalize_csv } from "@/lib/cells";
import { cn, formatBytes } from "@/lib/utils";
import {
  type Fields,
  files_to_shp,
  friendlyError,
  get_kml_from_kmz,
  make_boundary_zip,
  save_zip,
  type ShpResult,
} from "@/lib/boundary";
import {
  combine_previews,
  preview_source,
  sniff_format,
  type SourceFormat,
} from "@/lib/preview";

const SAMPLE_CSV = `编号,X,Y
1,3797916.479,39547228.491
2,3798076.324,39547246.449
3,3798062.844,39547399.598
4,3797655.744,39547381.907
5,3797694.864,39546951.091
6,3797942.755,39546979.970`;

const INITIAL_FORM: FormValues = {
  stage: "初步调查",
  dkmc: "",
  dkdm: "",
  xzqmc: "",
  xzqdm: "",
  ydmj: "",
  dh: "",
  scrq: "",
  scdw: "",
  bz: "",
};

const ID_FIELDS: Array<{
  key: FieldKey;
  label: string;
  placeholder: string;
  limit: number;
  required?: boolean;
  wide?: boolean;
}> = [
  {
    key: "dkmc",
    label: "地块名称",
    placeholder: "例如：某某地块",
    limit: 254,
    required: true,
    wide: true,
  },
  {
    key: "dkdm",
    label: "地块代码",
    placeholder: "例如：3401002026001",
    limit: 100,
    required: true,
    wide: true,
  },
  {
    key: "xzqmc",
    label: "行政区名称",
    placeholder: "例如：某某县",
    limit: 100,
    required: true,
  },
  {
    key: "xzqdm",
    label: "行政区代码",
    placeholder: "12 位行政区代码",
    limit: 12,
    required: true,
  },
];

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  /** 标题旁的附加元素（图标等） */
  labelAddon?: ReactNode;
  error?: string | null;
  hint?: { text: string; warn: boolean } | null;
  note?: ReactNode;
  className?: string;
  children: ReactNode;
}

function Field(
  {
    id,
    label,
    required,
    labelAddon,
    error,
    hint,
    note,
    className,
    children,
  }: FieldProps,
) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1">
          <Label htmlFor={id} className={cn(error && "text-destructive")}>
            {label}
            {required && <span className="ml-0.5 text-destructive">*</span>}
          </Label>
          {labelAddon}
        </div>
        {hint && (
          <span
            className={cn(
              "text-[11px] tabular-nums",
              hint.warn ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {hint.text}
          </span>
        )}
      </div>
      {children}
      {note}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

interface SourceItem {
  id: string;
  /** 文件名；粘贴的文本为 null */
  name: string | null;
  text: string;
  format: SourceFormat;
}

let sourceSeq = 0;
const nextId = () => `s${++sourceSeq}`;

const FILE_LIMITS = { text: 2 * 1024 * 1024, kmz: 20 * 1024 * 1024 };

export default function Tool() {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [inputMode, setInputMode] = useState<"file" | "paste">("file");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [form, setForm] = useState<FormValues>(INITIAL_FORM);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>(
    {},
  );
  const [submitted, setSubmitted] = useState(false);

  const [shp, setShp] = useState<ShpResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<
    { name: string; size: number; status: "saved" | "downloaded" } | null
  >(null);
  const [saveCancelled, setSaveCancelled] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [centerCopied, setCenterCopied] = useState(false);

  const zoneValue = useMemo(() => {
    const parsed = Number(form.dh);
    return form.dh.trim() !== "" && Number.isInteger(parsed) &&
        parsed >= 25 && parsed <= 45
      ? parsed
      : DEFAULT_ZONE;
  }, [form.dh]);

  const previews = useMemo(
    () =>
      sources.map((item) => ({
        item,
        preview: preview_source(item.format, item.text, zoneValue),
      })),
    [sources, zoneValue],
  );
  const preview = useMemo(
    () => combine_previews(previews.map((entry) => entry.preview)),
    [previews],
  );
  const sourceError = useMemo(() => {
    const failed = previews.find((entry) => entry.preview.error);
    if (!failed) return null;
    return failed.item.name
      ? `${failed.item.name}：${failed.preview.error}`
      : failed.preview.error;
  }, [previews]);
  const displayError = loadError ?? parseError ?? sourceError;
  const errors = useMemo(() => validateFields(form), [form]);

  useEffect(() => {
    if (sources.length === 0) {
      setShp(null);
      setParseError(null);
      setParsing(false);
      return;
    }

    let cancelled = false;
    setParsing(true);

    const timer = setTimeout(async () => {
      try {
        const result = await files_to_shp(
          sources.map((item) => ({
            name: item.name ?? `粘贴数据.${item.format}`,
            content: item.format === "csv"
              ? normalize_csv(item.text, zoneValue).text
              : item.text,
          })),
        );
        if (cancelled) return;
        setShp(result);
        setParseError(null);
      } catch (error) {
        if (cancelled) return;
        setShp(null);
        setParseError(friendlyError(error));
      } finally {
        if (!cancelled) setParsing(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sources, zoneValue]);

  const setField = <K extends FieldKey>(key: K, value: FormValues[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const touch = (key: FieldKey) =>
    setTouched((previous) => ({ ...previous, [key]: true }));

  const applyText = (
    text: string,
    name: string | null,
    format?: SourceFormat,
    fit = true,
  ) => {
    if (!text.trim()) {
      setSources([]);
      setLoadError(null);
      return;
    }
    setLoadError(null);
    setSources([{
      id: nextId(),
      name,
      text,
      format: format ?? sniff_format(text),
    }]);
    setDone(null);
    setGenError(null);
    if (fit) setFitToken((token) => token + 1);
  };

  const clearSources = () => {
    setSources([]);
    setShp(null);
    setParseError(null);
    setLoadError(null);
    setDone(null);
    setGenError(null);
  };

  const centerText = preview.center
    ? `${preview.center[0].toFixed(6)}, ${preview.center[1].toFixed(6)}`
    : null;

  const copyCenter = async () => {
    if (!centerText) return;
    try {
      await navigator.clipboard.writeText(centerText);
      setCenterCopied(true);
      setTimeout(() => setCenterCopied(false), 1500);
    } catch {
      // 剪贴板不可用（非安全上下文）时静默失败
    }
  };

  const removeSource = (id: string) => {
    setSources((previous) => {
      const next = previous.filter((item) => item.id !== id);
      if (next.length === 0) {
        setShp(null);
        setParseError(null);
      }
      return next;
    });
    setDone(null);
    setGenError(null);
  };

  const loadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const items: SourceItem[] = [];
    const failures: string[] = [];

    for (const file of files) {
      const ext = file.name.toLowerCase().split(".").pop() ?? "";
      const isKmz = ext === "kmz";
      const limit = isKmz ? FILE_LIMITS.kmz : FILE_LIMITS.text;
      if (file.size > limit) {
        failures.push(`${file.name}：超过 ${isKmz ? "20 MB" : "2 MB"}`);
        continue;
      }
      try {
        if (isKmz) {
          const kml = get_kml_from_kmz(
            new Uint8Array(await file.arrayBuffer()),
          );
          items.push({
            id: nextId(),
            name: file.name,
            text: kml,
            format: "kml",
          });
        } else if (ext === "kml") {
          items.push({
            id: nextId(),
            name: file.name,
            text: await file.text(),
            format: "kml",
          });
        } else if (ext === "csv" || ext === "txt") {
          items.push({
            id: nextId(),
            name: file.name,
            text: await file.text(),
            format: "csv",
          });
        } else {
          failures.push(`${file.name}：仅支持 .csv / .kml / .kmz`);
        }
      } catch (error) {
        failures.push(`${file.name}：${friendlyError(error)}`);
      }
    }

    setLoadError(failures.length > 0 ? failures.join("；") : null);
    if (items.length > 0) {
      setSources(items);
      setDone(null);
      setGenError(null);
      setFitToken((token) => token + 1);
    }
  };

  const showError = (key: FieldKey) =>
    (touched[key] || submitted) && errors[key] ? errors[key] : null;

  const byteHint = (key: FieldKey, limit: number, always = false) => {
    const bytes = byteLength(form[key]);
    if (bytes === 0) return null;
    if (!always && bytes < limit * 0.8) return null;
    return { text: `${bytes}/${limit} 字节`, warn: bytes > limit };
  };

  const handleGenerate = async () => {
    setSubmitted(true);
    setDone(null);
    setGenError(null);

    if (Object.keys(errors).length > 0) return;
    if (parsing) return;
    if (!shp) {
      setGenError(displayError ?? "请先提供有效的坐标数据");
      return;
    }

    setBusy(true);
    setSaveCancelled(false);
    try {
      const fields: Fields = {
        DKMC: form.dkmc.trim(),
        DKDM: form.dkdm.trim(),
        XZQDM: form.xzqdm.trim(),
        XZQMC: form.xzqmc.trim(),
        YDMJ: form.ydmj.trim() ? Number(form.ydmj) : shp.YDMJ,
        DH: form.dh.trim() ? Number(form.dh) : shp.DH,
        SCRQ: form.scrq ? new Date(`${form.scrq}T00:00:00`) : new Date(),
        SCDW: form.scdw.trim() || null,
        BZ: form.bz.trim() || null,
      };
      const data = await make_boundary_zip(form.stage, fields, shp.shp);
      const name = `${form.stage}${form.dkdm.trim()}.zip`;
      const result = await save_zip(data, name);
      if (result.status === "cancelled") {
        setDone(null);
        setSaveCancelled(true);
        return;
      }
      setDone({ name: result.name, size: result.size, status: result.status });
    } catch (error) {
      setGenError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] px-4 py-4 sm:px-6 lg:h-full">
      <div className="grid gap-4 lg:h-full lg:min-h-0 lg:grid-cols-[280px_380px_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[300px_400px_minmax(0,1fr)]">
        {/* 坐标数据 */}
        <section
          aria-labelledby="data-heading"
          className="order-1 rounded-xl border border-border/80 bg-card p-4 lg:col-start-1 lg:row-start-1"
        >
          <div className="flex items-center justify-between gap-2">
            <h2
              id="data-heading"
              className="text-sm font-semibold tracking-tight"
            >
              坐标数据
            </h2>
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
              CSV / KML / KMZ
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
            {(
              [
                ["file", "上传文件"],
                ["paste", "粘贴文本"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={inputMode === value}
                onClick={() => setInputMode(value)}
                className={cn(
                  "h-7 rounded text-xs font-medium transition-colors",
                  inputMode === value
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {inputMode === "file"
            ? (
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const files = Array.from(event.dataTransfer.files ?? []);
                  if (files.length > 0) void loadFiles(files);
                }}
                className={cn(
                  "mt-3 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
                  dragging
                    ? "border-primary bg-accent"
                    : "border-input hover:border-ring/50",
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".csv,.kml,.kmz,.txt,text/csv,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
                  className="sr-only"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    if (files.length > 0) void loadFiles(files);
                    event.currentTarget.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload />
                  选择 CSV / KML / KMZ
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  拖拽到此处，或点击选择（可多选）。文件只在本机浏览器中处理。
                </p>
              </div>
            )
            : (
              <>
                <Textarea
                  value={sources.length === 1 ? sources[0].text : ""}
                  onChange={(event) =>
                    applyText(event.target.value, null, undefined, false)}
                  placeholder={"编号,X,Y\n1,117.51307,34.307738\n2,117.51402,34.307811"}
                  spellCheck={false}
                  className="mt-3 h-40 font-mono text-xs"
                />
                {sources.length > 1 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    粘贴文本会替换当前的 {sources.length} 个文件
                  </p>
                )}
              </>
            )}

          {sources.length > 0 && (
            <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto">
              {sources.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded-md border bg-background px-2 py-1"
                >
                  <FileText className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {item.name ?? "粘贴的数据"}
                  </span>
                  <button
                    type="button"
                    aria-label={`移除 ${item.name ?? "粘贴的数据"}`}
                    onClick={() => removeSource(item.id)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => applyText(SAMPLE_CSV, "坐标_投影.csv", "csv")}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              载入示例数据
            </button>
            {sources.length > 0 && (
              <button
                type="button"
                onClick={clearSources}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
                清除
              </button>
            )}
          </div>

          {sources.length > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-md border bg-muted/60 px-3 py-2 text-xs">
              {parsing
                ? (
                  <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
                )
                : displayError
                ? <CircleAlert className="size-3.5 text-destructive" />
                : <CircleCheck className="size-3.5 text-success" />}
              <span className="truncate">
                {preview.pointCount} 个点 · {preview.label}
              </span>
            </div>
          )}

          {centerText && (
            <div className="mt-2 rounded-md border bg-muted/60 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">中心点</span>
                <button
                  type="button"
                  onClick={copyCenter}
                  className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {centerCopied
                    ? <CircleCheck className="size-3 text-success" />
                    : <Copy className="size-3" />}
                  {centerCopied ? "已复制" : "复制"}
                </button>
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-foreground">
                {centerText}
              </p>
            </div>
          )}

          {displayError && (
            <div
              role="alert"
              className="mt-3 flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <p>{displayError}</p>
            </div>
          )}
        </section>

        {/* 地块信息 */}
        <section
          aria-labelledby="fields-heading"
          className="order-2 rounded-xl border border-border/80 bg-card p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-full lg:self-start lg:overflow-y-auto"
        >
          <h2
            id="fields-heading"
            className="text-sm font-semibold tracking-tight"
          >
            地块信息
          </h2>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field
              id="field-stage"
              label="调查阶段"
              className="sm:col-span-2"
            >
              <select
                id="field-stage"
                value={form.stage}
                onChange={(event) =>
                  setField("stage", event.target.value as Stage)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                {STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </select>
            </Field>

            {ID_FIELDS.map((field) => (
              <Field
                key={field.key}
                id={`field-${field.key}`}
                label={field.label}
                required={field.required}
                error={showError(field.key)}
                hint={byteHint(field.key, field.limit, field.key === "xzqdm")}
                className={field.wide ? "sm:col-span-2" : undefined}
              >
                <Input
                  id={`field-${field.key}`}
                  value={form[field.key]}
                  placeholder={field.placeholder}
                  aria-invalid={showError(field.key) ? true : undefined}
                  onChange={(event) => setField(field.key, event.target.value)}
                  onBlur={() => touch(field.key)}
                />
              </Field>
            ))}

            <Field
              id="field-ydmj"
              label="用地面积（m²）"
              error={showError("ydmj")}
              note={shp && !form.ydmj.trim()
                ? (
                  <p className="text-[11px] text-muted-foreground">
                    留空自动计算：{shp.YDMJ} m²
                  </p>
                )
                : null}
            >
              <Input
                id="field-ydmj"
                inputMode="decimal"
                value={form.ydmj}
                placeholder={shp ? `自动 ${shp.YDMJ}` : "留空自动计算"}
                aria-invalid={showError("ydmj") ? true : undefined}
                onChange={(event) => setField("ydmj", event.target.value)}
                onBlur={() => touch("ydmj")}
              />
            </Field>

            <Field
              id="field-dh"
              label="带号"
              labelAddon={preview.zoneInferred
                ? (
                  <Tooltip
                    label={`坐标缺带号，已按带号 ${zoneValue} 投影。观察地图，调节带号，直到地块位置正确。`}
                  >
                    <TriangleAlert className="size-3.5 text-amber-600" />
                  </Tooltip>
                )
                : null}
              error={showError("dh")}
              note={shp && !form.dh.trim()
                ? (
                  <p className="text-[11px] text-muted-foreground">
                    留空自动计算：{shp.DH}
                  </p>
                )
                : null}
            >
              <Input
                id="field-dh"
                type="number"
                min={25}
                max={45}
                step={1}
                value={form.dh}
                placeholder={preview.zoneInferred
                  ? `缺省 ${DEFAULT_ZONE}`
                  : shp
                  ? `自动 ${shp.DH}`
                  : "留空自动计算"}
                aria-invalid={showError("dh") ? true : undefined}
                onChange={(event) => setField("dh", event.target.value)}
                onBlur={() => touch("dh")}
              />
            </Field>

            <Field id="field-scrq" label="生产日期">
              <Input
                id="field-scrq"
                type="date"
                value={form.scrq}
                onChange={(event) => setField("scrq", event.target.value)}
                onBlur={() => touch("scrq")}
              />
            </Field>

            <Field
              id="field-scdw"
              label="生产单位"
              error={showError("scdw")}
              hint={byteHint("scdw", 254)}
            >
              <Input
                id="field-scdw"
                value={form.scdw}
                placeholder="可选"
                aria-invalid={showError("scdw") ? true : undefined}
                onChange={(event) => setField("scdw", event.target.value)}
                onBlur={() => touch("scdw")}
              />
            </Field>

            <Field
              id="field-bz"
              label="备注"
              error={showError("bz")}
              hint={byteHint("bz", 254)}
              className="sm:col-span-2"
            >
              <Textarea
                id="field-bz"
                value={form.bz}
                aria-invalid={showError("bz") ? true : undefined}
                onChange={(event) => setField("bz", event.target.value)}
                onBlur={() => touch("bz")}
                className="h-16"
              />
            </Field>
          </div>
        </section>

        {/* 生成 */}
        <section
          aria-labelledby="output-heading"
          className="order-3 rounded-xl border border-border/80 bg-card p-4 lg:col-start-1 lg:row-start-2 lg:self-start"
        >
          <h2
            id="output-heading"
            className="text-sm font-semibold tracking-tight"
          >
            生成
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            输出 {form.stage}
            {form.dkdm.trim() || "地块代码"}.zip，内含 CGCS2000 坐标系的
            Shapefile 五件套。
          </p>

          <Button
            type="button"
            size="lg"
            className="mt-3 w-full border border-blue-600/35 bg-sky-400/30 text-blue-700 shadow-none hover:bg-blue-500/40 hover:text-blue-800"
            onClick={handleGenerate}
            disabled={busy || parsing}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <Download />}
            {busy ? "正在生成…" : "生成边界文件"}
          </Button>

          {submitted && Object.keys(errors).length > 0 && (
            <p className="mt-2 text-xs text-destructive">
              请先修正标红的 {Object.keys(errors).length} 个字段
            </p>
          )}

          {genError && (
            <div
              role="alert"
              className="mt-3 flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <p>{genError}</p>
            </div>
          )}

          {done && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs">
              <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {done.status === "saved" ? "已保存" : "已下载"} {done.name}
                </p>
                <p className="text-muted-foreground">
                  {formatBytes(done.size)}
                  {done.status === "downloaded" ? "，已开始下载" : ""}
                </p>
              </div>
            </div>
          )}

          {saveCancelled && (
            <p className="mt-2 text-xs text-muted-foreground">已取消保存</p>
          )}
        </section>

        {/* 地图 */}
        <section
          aria-label="地块预览"
          className="order-4 min-h-0 lg:order-0 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:h-full"
        >
          <div className="relative h-80 overflow-hidden rounded-xl border border-border/80 bg-muted sm:h-100 lg:h-full">
            <MapPreview polygons={preview.polygons} fitToken={fitToken} />

            <div className="pointer-events-none absolute left-3 top-3">
              <span className="inline-block whitespace-nowrap rounded-md border bg-background px-2 py-1 text-xs font-medium">
                {form.stage}
                {form.dkdm.trim() ? ` ${form.dkdm.trim()}` : ""}
              </span>
            </div>

            {preview.polygons.length === 0 && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
                <div className="max-w-xs rounded-lg border bg-background px-4 py-3 text-center text-xs text-muted-foreground">
                  <MapPin className="mx-auto mb-1.5 size-4" />
                  上传 CSV / KML / KMZ 或粘贴坐标后，地块边界会显示在这里
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
