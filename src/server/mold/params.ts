import "server-only";
import { MOLD_PARAM_MAP, MOLD_RESERVED_KEYS } from "@/config/mold-params";

/**
 * Strict server-side validator for mold params (mold-studio ticket 11).
 * The engine only rejects UNKNOWN keys — min/max/enum pass through — so this
 * is the layer that actually enforces the catalog's ranges before submission.
 */

export interface ValidatedMoldParams {
  /** Add-on parameters only (no reserved keys). */
  props: Record<string, string | number | boolean>;
  /** Reserved: uniform scale baked into the mesh before the pipeline. */
  modelScale: number | null;
  /** Reserved: [rx, ry, rz] degrees, baked before the pipeline. */
  modelRotation: [number, number, number] | null;
}

export type ValidateResult =
  | { ok: true; value: ValidatedMoldParams }
  | { ok: false; error: string; key?: string };

export function validateMoldParams(
  input: unknown,
  modelScale: number | null,
): ValidateResult {
  if (input === undefined || input === null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "params_must_be_object" };
  }

  const props: Record<string, string | number | boolean> = {};
  let modelRotation: [number, number, number] | null = null;

  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (key === "model_scale") {
      return { ok: false, error: "reserved_key_forbidden", key };
    }
    if (key === "model_rotation") {
      const rot = parseRotation(raw);
      if (!rot) return { ok: false, error: "invalid_model_rotation", key };
      modelRotation = rot;
      continue;
    }
    const spec = MOLD_PARAM_MAP[key];
    if (!spec || (MOLD_RESERVED_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: "unknown_param", key };
    }
    switch (spec.type) {
      case "bool":
        if (typeof raw !== "boolean") {
          return { ok: false, error: "invalid_bool", key };
        }
        props[key] = raw;
        break;
      case "int":
        if (typeof raw !== "number" || !Number.isInteger(raw)) {
          return { ok: false, error: "invalid_int", key };
        }
        if (
          (spec.min !== undefined && raw < spec.min) ||
          (spec.max !== undefined && raw > spec.max)
        ) {
          return { ok: false, error: "out_of_range", key };
        }
        props[key] = raw;
        break;
      case "float":
        if (typeof raw !== "number" || !Number.isFinite(raw)) {
          return { ok: false, error: "invalid_float", key };
        }
        if (
          (spec.min !== undefined && raw < spec.min) ||
          (spec.max !== undefined && raw > spec.max)
        ) {
          return { ok: false, error: "out_of_range", key };
        }
        props[key] = raw;
        break;
      case "enum":
        if (
          typeof raw !== "string" ||
          !spec.options!.some((o) => o.value === raw)
        ) {
          return { ok: false, error: "invalid_enum_value", key };
        }
        props[key] = raw;
        break;
      case "rotation3":
        return { ok: false, error: "reserved_type_not_allowed", key };
    }
  }

  return { ok: true, value: { props, modelScale, modelRotation } };
}

function parseRotation(raw: unknown): [number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    // UI steps by 5°; keep the same span the intake step allowed.
    out.push(Math.max(-180, Math.min(180, v)));
  }
  return out as [number, number, number];
}
