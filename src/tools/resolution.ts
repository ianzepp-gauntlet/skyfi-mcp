import { z } from "zod";
import type { Resolution } from "../client/types.js";

const taskingResolutionAliases = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  VERY_HIGH: "VERY HIGH",
  "VERY HIGH": "VERY HIGH",
  SUPER_HIGH: "SUPER HIGH",
  "SUPER HIGH": "SUPER HIGH",
  ULTRA_HIGH: "ULTRA HIGH",
  "ULTRA HIGH": "ULTRA HIGH",
} as const satisfies Record<string, Resolution>;

export const taskingResolutionInputSchema = z
  .enum([
    "LOW",
    "MEDIUM",
    "HIGH",
    "VERY_HIGH",
    "VERY HIGH",
    "SUPER_HIGH",
    "SUPER HIGH",
    "ULTRA_HIGH",
    "ULTRA HIGH",
  ])
  .describe(
    "Desired resolution. Spaced API values are canonical; underscore aliases are accepted for compatibility.",
  );

export type TaskingResolutionInput = z.infer<
  typeof taskingResolutionInputSchema
>;

export function normalizeTaskingResolution(
  resolution: TaskingResolutionInput,
): Resolution {
  return taskingResolutionAliases[resolution];
}
