export const STAGES = ["初步调查", "详细调查"] as const;
export type Stage = (typeof STAGES)[number];

/** 与 DBF 字段宽度一致（单位：UTF-8 字节） */
export const TEXT_LIMITS = {
  DKMC: 254,
  DKDM: 100,
  XZQDM: 12,
  XZQMC: 100,
  SCDW: 254,
  BZ: 254,
} as const;

export interface FormValues {
  stage: Stage;
  dkmc: string;
  dkdm: string;
  xzqmc: string;
  xzqdm: string;
  ydmj: string;
  dh: string;
  scrq: string;
  scdw: string;
  bz: string;
}

export type FieldKey = keyof FormValues;
export type FormErrors = Partial<Record<FieldKey, string>>;

const encoder = new TextEncoder();
export const byteLength = (value: string) => encoder.encode(value).length;

export function todayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${
    pad(now.getDate())
  }`;
}

export function validateFields(values: FormValues): FormErrors {
  const errors: FormErrors = {};

  const required: Array<[FieldKey, string]> = [
    ["dkmc", "地块名称"],
    ["dkdm", "地块代码"],
    ["xzqmc", "行政区名称"],
    ["xzqdm", "行政区代码"],
  ];
  for (const [key, label] of required) {
    if (!values[key].trim()) {
      errors[key] = `请填写${label}`;
    }
  }

  const limits: Array<[FieldKey, keyof typeof TEXT_LIMITS, string]> = [
    ["dkmc", "DKMC", "地块名称"],
    ["dkdm", "DKDM", "地块代码"],
    ["xzqmc", "XZQMC", "行政区名称"],
    ["xzqdm", "XZQDM", "行政区代码"],
    ["scdw", "SCDW", "生产单位"],
    ["bz", "BZ", "备注"],
  ];
  for (const [key, field, label] of limits) {
    const bytes = byteLength(values[key]);
    if (bytes > TEXT_LIMITS[field]) {
      errors[key] = `${label}超出 ${field} 字段宽度（${bytes} / ${
        TEXT_LIMITS[field]
      } 字节，中文按 3 字节计）`;
    }
  }

  if (values.ydmj.trim() !== "") {
    const area = Number(values.ydmj);
    if (!Number.isFinite(area) || area <= 0) {
      errors.ydmj = "面积需为正数";
    }
  }

  if (values.dh.trim() !== "") {
    const zone = Number(values.dh);
    if (!Number.isInteger(zone) || zone < 25 || zone > 45) {
      errors.dh = "带号需为 25~45 的整数";
    }
  }

  if (values.scrq.trim() !== "") {
    if (Number.isNaN(new Date(values.scrq).getTime())) {
      errors.scrq = "日期格式应为 YYYY-MM-DD";
    }
  }

  return errors;
}
