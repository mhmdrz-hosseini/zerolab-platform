"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  MOLD_DEFAULTS,
  MOLD_PARAM_GROUPS,
  MOLD_PARAMS,
  type MoldParamSpec,
  type MoldParamValue,
  type MoldParamValues,
} from "@/config/mold-params";

/**
 * Studio parameter panel (mold-studio ticket 13) — the four essential params
 * up front, everything else in the «تنظیمات پیشرفته» accordion, mirroring the
 * forge's conditional visibility (schema.js `when:` rules) for the options
 * that depend on the mold type / base style / split mode.
 *
 * UI defaults per ticket 03/12: cast_preset starts at WAX (brand default),
 * not the engine's CUSTOM.
 */

export const STUDIO_UI_DEFAULTS: MoldParamValues = {
  ...MOLD_DEFAULTS,
  cast_preset: "WAX",
};

const fa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

const ADVANCED_ORDER: MoldParamSpec["group"][] = [
  "mold",
  "tray",
  "split",
  "sprue",
  "mesh",
  "material",
  "transform",
];

/** The forge's conditional visibility, ported for the advanced controls. */
function advancedVisible(
  key: string,
  v: MoldParamValues,
): boolean {
  const n = (x: MoldParamValue | undefined): number =>
    typeof x === "number" ? x : 0;
  switch (key) {
    case "tray_mode":
    case "tray_up":
    case "tray_outline":
    case "tray_wall":
    case "tray_floor":
    case "tray_margin":
    case "tray_depth":
      return v.box_style === "TRAY";
    case "solid_shape":
      return v.box_style === "SOLID";
    case "shell_wall":
    case "skin_keys":
      return v.box_style === "POUR_BOX";
    case "base_style":
    case "wall_thickness":
      return v.box_style !== "TRAY";
    case "base_flange":
      return v.base_style === "FLAT";
    case "flange_width":
      return v.base_style === "FLAT" && v.base_flange === true;
    case "base_plate":
      return v.base_style === "OPEN";
    case "fit_clearance":
      return v.base_style === "OPEN" && v.base_plate === true;
    case "split_horizontal":
    case "parts_count":
      return v.box_style !== "TRAY";
    case "split_z_offset":
      return v.split_horizontal === true;
    case "split_axis":
    case "split_offset":
    case "contoured":
      return v.box_style !== "TRAY" && n(v.parts_count) < 3;
    case "key_count":
      if (v.box_style === "TRAY") return false;
      return n(v.parts_count) >= 3 ? true : v.contoured !== true;
    case "registration":
      return (
        v.box_style !== "TRAY" &&
        n(v.parts_count) < 3 &&
        v.contoured !== true &&
        n(v.key_count) > 0 &&
        v.wings !== true
      );
    case "wings":
      return v.box_style !== "TRAY";
    case "wing_width":
    case "bolt_diameter":
    case "bolt_auto":
      return v.wings === true;
    case "bolt_count":
      return v.wings === true && v.bolt_auto !== true;
    case "sprue":
    case "vent_count":
      return v.box_style !== "TRAY";
    case "sprue_radius":
    case "big_throat":
    case "funnel_height":
    case "sprue_flare":
    case "big_mouth":
    case "sprue_count":
    case "sprue_place":
      return v.sprue === true;
    case "sprue_x":
    case "sprue_y":
      return v.sprue === true && v.sprue_place === "MANUAL";
    case "vent_radius":
      return n(v.vent_count) > 0;
    case "decimate_ratio":
      return v.decimate === true;
    case "voxel_size":
      return v.voxel_safe === true;
    default:
      return true;
  }
}

/* ---------------- know-more ---------------- */

function KnowMore({
  spec,
  onOpen,
}: {
  spec: MoldParamSpec;
  onOpen: (spec: MoldParamSpec) => void;
}) {
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`توضیح ${spec.label}`}
        onClick={() => onOpen(spec)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-line bg-paper text-[9px] font-extrabold text-plum transition hover:border-plum/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
      >
        ؟
      </button>
      <span className="pointer-events-none absolute bottom-140% start-1/2 z-20 w-52 -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-[10px] font-medium leading-5 text-paper opacity-0 shadow-lg transition group-hover/km:opacity-100">
        {spec.hint} <span className="opacity-70">(کلیک: توضیح کامل)</span>
      </span>
    </span>
  );
}

export function KnowMoreDialog({
  spec,
  onClose,
}: {
  spec: MoldParamSpec | null;
  onClose: () => void;
}) {
  if (!spec) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-5"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={spec.label}
        className="max-h-[76dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-paper p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "zl-rise 0.25s ease-out both" }}
      >
        <h3 className="text-sm font-extrabold text-plum">{spec.label}</h3>
        <p className="mt-2 text-xs leading-7 text-ink/85">{spec.knowMore}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 rounded-full bg-plum px-4 py-1.5 text-xs font-bold text-paper transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
        >
          فهمیدم
        </button>
      </div>
    </div>
  );
}

/* ---------------- controls ---------------- */

function NumberControl({
  spec,
  value,
  onChange,
}: {
  spec: MoldParamSpec;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={spec.min}
      max={spec.max}
      step={spec.step ?? (spec.type === "int" ? 1 : 0.1)}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={spec.label}
      className="w-24 rounded-lg border border-line bg-paper px-2 py-1 text-left text-xs tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
      dir="ltr"
    />
  );
}

function AdvancedRow({
  spec,
  values,
  onChange,
  onKnowMore,
}: {
  spec: MoldParamSpec;
  values: MoldParamValues;
  onChange: (key: string, value: MoldParamValue) => void;
  onKnowMore: (spec: MoldParamSpec) => void;
}) {
  const value = values[spec.key];
  return (
    <div className="group/km flex items-center gap-2 border-b border-dashed border-line/70 py-2 last:border-b-0">
      <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-ink/85">
        {spec.label}
        {spec.unit === "mm" && (
          <span className="text-[9px] font-normal text-ink/40">(میلی‌متر)</span>
        )}
        <KnowMore spec={spec} onOpen={onKnowMore} />
      </span>
      <span className="ms-auto flex items-center gap-1.5">
        {spec.type === "bool" && (
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(spec.key, e.target.checked)}
            aria-label={spec.label}
            className="h-4 w-4 accent-[var(--plum)]"
          />
        )}
        {spec.type === "enum" && (
          <select
            value={String(value)}
            onChange={(e) => onChange(spec.key, e.target.value)}
            aria-label={spec.label}
            className="w-40 rounded-lg border border-line bg-paper px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
          >
            {spec.options!.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {(spec.type === "int" || spec.type === "float") && (
          <NumberControl
            spec={spec}
            value={Number(value)}
            onChange={(n) => onChange(spec.key, n)}
          />
        )}
        {spec.type === "rotation3" && (
          <span className="flex gap-1" dir="ltr">
            {(["X", "Y", "Z"] as const).map((axis, i) => (
              <input
                key={axis}
                type="number"
                value={(value as [number, number, number])[i]}
                step={5}
                min={-180}
                max={180}
                onChange={(e) => {
                  const rot = [...(value as [number, number, number])] as [
                    number,
                    number,
                    number,
                  ];
                  rot[i] = Number(e.target.value);
                  onChange(spec.key, rot);
                }}
                aria-label={`چرخش ${axis}`}
                className="w-14 rounded-lg border border-line bg-paper px-1.5 py-1 text-center text-xs tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
              />
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

/* ---------------- panel ---------------- */

export function ParamsPanel({
  values,
  onChange,
  advising,
}: {
  values: MoldParamValues;
  onChange: (key: string, value: MoldParamValue) => void;
  advising?: ReactNode;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [knowMore, setKnowMore] = useState<MoldParamSpec | null>(null);

  const specOf = useMemo(
    () => new Map(MOLD_PARAMS.map((p) => [p.key, p])),
    [],
  );
  const boxStyle = String(values.box_style);

  const advancedByGroup = useMemo(() => {
    const groups = new Map<string, MoldParamSpec[]>();
    for (const p of MOLD_PARAMS) {
      if (p.tier !== "advanced" || p.key === "model_rotation") continue;
      if (p.key === "model_rotation") continue;
      if (!advancedVisible(p.key, values)) continue;
      const list = groups.get(p.group) ?? [];
      list.push(p);
      groups.set(p.group, list);
    }
    // rotation always available under transform
    const rot = specOf.get("model_rotation");
    if (rot) {
      const list = groups.get("transform") ?? [];
      list.push(rot);
      groups.set("transform", list);
    }
    return groups;
  }, [values, specOf]);

  return (
    <>
      {advising}

      {/* ۱ — نوع قالب */}
      <section className="mb-5" aria-label="نوع قالب">
        <SectionTitle spec={specOf.get("box_style")!} onKnowMore={setKnowMore} num="۱" />
        <div className="grid grid-cols-3 gap-2">
          {specOf.get("box_style")!.options!.map((o) => {
            const selected = boxStyle === o.value;
            const meta: Record<string, { ic: string; d: string }> = {
              POUR_BOX: { ic: "🧊", d: "کیفیت بالا، تولید انبوه" },
              SOLID: { ic: "🖨️", d: "سریع و ارزان، متریال محدود" },
              TRAY: { ic: "🥧", d: "برای طرح‌های تخت" },
            };
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange("box_style", o.value)}
                className={`rounded-2xl border p-2.5 text-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum ${
                  selected
                    ? "border-plum bg-accent-soft/40 shadow-[0_0_0_3px_rgba(107,61,72,0.10)]"
                    : "border-line bg-paper hover:border-plum/40"
                }`}
              >
                <div className="text-xl">{meta[o.value].ic}</div>
                <div className="mt-1 text-[11px] font-extrabold">{o.label}</div>
                <div className="mt-0.5 text-[9.5px] leading-4 text-ink/55">
                  {meta[o.value].d}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ۲ — متریال ریختگی */}
      <section className="mb-5" aria-label="متریال ریختگی">
        <SectionTitle spec={specOf.get("cast_preset")!} onKnowMore={setKnowMore} num="۲" />
        <div className="flex flex-wrap gap-1.5">
          {specOf.get("cast_preset")!.options!.map((o) => {
            const selected = values.cast_preset === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange("cast_preset", o.value)}
                className={`rounded-full border px-3 py-1.5 text-[11.5px] font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum ${
                  selected
                    ? "border-plum bg-plum text-paper"
                    : "border-line bg-paper hover:border-plum/40"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* ۳ — تعداد قطعات */}
      <section className="mb-5" aria-label="تعداد قطعات قالب">
        <SectionTitle spec={specOf.get("parts_count")!} onKnowMore={setKnowMore} num="۳" />
        <div className="flex overflow-hidden rounded-xl border-[1.5px] border-line">
          {[2, 3, 4].map((n) => {
            const selected = values.parts_count === n;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange("parts_count", n)}
                className={`flex-1 py-2 text-xs font-extrabold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum ${
                  n > 2 ? "border-s border-line" : ""
                } ${selected ? "bg-plum text-paper" : "bg-paper hover:text-plum"}`}
              >
                {fa(n)} قطعه
              </button>
            );
          })}
        </div>
      </section>

      {/* ۴ — ضخامت سیلیکون */}
      <section className="mb-5" aria-label="ضخامت سیلیکون">
        <SectionTitle spec={specOf.get("wall_thickness")!} onKnowMore={setKnowMore} num="۴" />
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] text-ink/45">۲</span>
          <input
            type="range"
            min={2}
            max={8}
            step={0.5}
            value={Number(values.wall_thickness)}
            onChange={(e) => onChange("wall_thickness", Number(e.target.value))}
            aria-label="ضخامت سیلیکون"
            className="flex-1"
            style={{ accentColor: "var(--plum)" }}
          />
          <span className="text-[10px] text-ink/45">۸</span>
          <span className="min-w-[64px] rounded-lg border border-line bg-cream px-2 py-1 text-center text-xs font-extrabold text-plum tabular-nums">
            {fa(Number(values.wall_thickness))} میلی‌متر
          </span>
        </div>
      </section>

      {/* تنظیمات پیشرفته */}
      <section className="mb-4" aria-label="تنظیمات پیشرفته">
        <div className="overflow-hidden rounded-2xl border border-line">
          <button
            type="button"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center gap-2 bg-cream px-3.5 py-3 text-xs font-extrabold transition hover:bg-cream/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
          >
            ⚙ تنظیمات پیشرفته
            <span className="text-[10px] font-medium text-ink/50">
              (پارامترهای مهندسی — پیش‌فرض‌ها بهینه‌اند)
            </span>
            <span
              className="ms-auto transition-transform"
              style={{ transform: advancedOpen ? "rotate(180deg)" : "none" }}
            >
              ⌄
            </span>
          </button>
          {advancedOpen && (
            <div className="max-h-[46dvh] overflow-y-auto px-3.5 pb-3.5">
              {ADVANCED_ORDER.filter((g) => advancedByGroup.has(g)).map((g) => (
                <div key={g}>
                  <div className="mt-3 text-[11px] font-extrabold text-teal">
                    {MOLD_PARAM_GROUPS[g]}
                  </div>
                  {advancedByGroup.get(g)!.map((spec) => (
                    <AdvancedRow
                      key={spec.key}
                      spec={spec}
                      values={values}
                      onChange={onChange}
                      onKnowMore={setKnowMore}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <KnowMoreDialog spec={knowMore} onClose={() => setKnowMore(null)} />
    </>
  );
}

function SectionTitle({
  spec,
  onKnowMore,
  num,
}: {
  spec: MoldParamSpec;
  onKnowMore: (spec: MoldParamSpec) => void;
  num: string;
}) {
  return (
    <div className="group/km mb-2 flex items-center gap-1.5">
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-plum text-[10px] font-extrabold text-paper">
        {num}
      </span>
      <span className="text-xs font-extrabold">{spec.label}</span>
      <KnowMore spec={spec} onOpen={onKnowMore} />
    </div>
  );
}
