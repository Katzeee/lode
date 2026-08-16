import { array, enumValue, exact, nonempty, object } from "../../shape-validation/index.js";
import type { FieldValueSeed } from "./field-value-types.js";
import type { SupertagFieldConfig } from "./supertag-field-config-types.js";

export function parseSupertagFieldConfig(value: unknown): SupertagFieldConfig {
  const config = object(value, "Supertag Field config");
  exact(config, ["visibility", "staticDefault"], "Supertag Field config");
  return {
    visibility: enumValue(config.visibility, ["pinned", "normal", "optional"] as const, "Field visibility"),
    staticDefault:
      config.staticDefault === null ? null : array(config.staticDefault, "Field static defaults", parseFieldValueSeed),
  };
}

export function parseFieldValueSeeds(value: unknown): readonly FieldValueSeed[] {
  return array(value, "Field value seeds", parseFieldValueSeed);
}

function parseFieldValueSeed(value: unknown): FieldValueSeed {
  const seed = object(value, "Field value seed");
  if (seed.kind === "text") {
    exact(seed, ["kind", "value"], "Field value seed");
    if (typeof seed.value !== "string") {
      throw new Error("Field text seed is invalid");
    }
    return { kind: "text", value: seed.value };
  }
  exact(seed, ["kind", "nodeId"], "Field value seed");
  if (seed.kind !== "reference") {
    throw new Error("Field value seed kind is invalid");
  }
  return { kind: "reference", nodeId: nonempty(seed.nodeId, "Reference Node identity") };
}
