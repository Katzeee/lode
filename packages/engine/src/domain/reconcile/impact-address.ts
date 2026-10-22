import { canonicalJson } from "../fact/index.js";

export function impactAddress(...parts: readonly unknown[]): string {
  return parts.map((part) => (typeof part === "string" ? part : canonicalJson(part))).join("/");
}
