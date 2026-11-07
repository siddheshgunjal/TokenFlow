import type { ModelUsage } from "./types";

export interface ModelColor {
  hex: string;
}

/**
 * The single source of truth for model colors. The first four entries exactly
 * preserve the current Models-card colors (accent, accent-blue, accent-strong,
 * warning); the rest extend the palette so additional models get stable,
 * distinct hues.
 */
export const MODEL_PALETTE: ModelColor[] = [
  { hex: "#00D4C0" }, // accent / teal
  { hex: "#2F6BFF" }, // accent-blue
  { hex: "#00A896" }, // accent-strong
  { hex: "#F5A623" }, // warning / amber
  { hex: "#A78BFA" }, // violet
  { hex: "#F472B6" }, // pink
  { hex: "#38BDF8" }, // sky
  { hex: "#FBBF24" }, // data-amber
  { hex: "#34D399" }, // emerald
  { hex: "#FB7185" }, // rose
  { hex: "#818CF8" }, // indigo
  { hex: "#E879F9" }, // fuchsia
];

/**
 * Maps each model in the 30-day snapshot to its color, in order, so the Models
 * card and the day-detail chart always agree. Built once per snapshot.
 */
export function buildModelColorMap(models: ModelUsage[]): Map<string, ModelColor> {
  const map = new Map<string, ModelColor>();
  models.forEach((model, index) => {
    map.set(model.model, MODEL_PALETTE[index % MODEL_PALETTE.length]);
  });
  return map;
}

/**
 * FNV-1a 32-bit hash into the palette. Used for models that exist on the
 * selected day but are absent from the 30-day snapshot, so the color is
 * deterministic (stable across renders) without a stored mapping.
 */
function fallbackColor(model: string): ModelColor {
  let hash = 0x811c9dc5;
  for (let index = 0; index < model.length; index += 1) {
    hash ^= model.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to an unsigned index into the palette.
  const index = (hash >>> 0) % MODEL_PALETTE.length;
  return MODEL_PALETTE[index];
}

/**
 * Returns the color for a model, falling back to a deterministic palette entry
 * when the model is not in the snapshot-derived map.
 */
export function colorForModel(
  map: Map<string, ModelColor>,
  model: string,
): ModelColor {
  return map.get(model) ?? fallbackColor(model);
}
