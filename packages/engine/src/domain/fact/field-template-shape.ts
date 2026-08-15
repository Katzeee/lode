import { array, enumValue, exact, nonempty, object } from "../../shape-validation/index.js";
import type { FieldTemplateConfig, FieldValueSeed } from "./field-template-types.js";

export function parseFieldTemplateConfig(value: unknown): FieldTemplateConfig {
  const config = object(value, "Field Template config");
  exact(config, ["visibility", "staticDefault", "initializer"], "Field Template config");
  return {
    visibility: enumValue(config.visibility, ["pinned", "normal", "optional"] as const, "Field visibility"),
    staticDefault:
      config.staticDefault === null ? null : array(config.staticDefault, "Field static defaults", parseFieldValueSeed),
    initializer: parseFieldInitializer(config.initializer),
  };
}

export function parseFieldValueSeeds(value: unknown): readonly FieldValueSeed[] {
  return array(value, "Field value seeds", parseFieldValueSeed);
}

function parseFieldInitializer(value: unknown): FieldTemplateConfig["initializer"] {
  if (value === null) {
    return null;
  }
  const initializer = object(value, "Field initializer");
  if (initializer.kind === "application-node-text") {
    exact(initializer, ["kind"], "Field initializer");
    return { kind: "application-node-text" };
  }
  exact(initializer, ["kind", "values"], "Field initializer");
  if (initializer.kind !== "literal") {
    throw new Error("Field initializer kind is invalid");
  }
  return { kind: "literal", values: parseFieldValueSeeds(initializer.values) };
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
