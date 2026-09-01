import type { FactActionId, FactId } from "./fact-value-types.js";
import { ShapeValidationError } from "../../decoding/index.js";

const FACT_ID_PATTERN = /^g\d+\/.+\/(?:0|[1-9]\d*)\/(?:0|[1-9]\d*)$/;
const FACT_ACTION_ID_PATTERN = /^g\d+\/.+\/(?:0|[1-9]\d*)\/(?:0|[1-9]\d*)\/actions\/(?:0|[1-9]\d*)$/;

export function isReplicaId(value: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(value);
}

function isFactId(value: string): value is FactId {
  return FACT_ID_PATTERN.test(value);
}

export function isFactActionId(value: string): value is FactActionId {
  return FACT_ACTION_ID_PATTERN.test(value);
}

export function requireFactId(value: unknown, label: string): FactId {
  if (typeof value !== "string" || !isFactId(value)) {
    throw new ShapeValidationError(`${label} must be a Fact identity`);
  }
  return value;
}

export function requireFactActionId(value: unknown, label: string): FactActionId {
  if (typeof value !== "string" || !isFactActionId(value)) {
    throw new ShapeValidationError(`${label} must be a Fact Action identity`);
  }
  return value;
}

export function requireFactIds(value: unknown, label: string, required = true): readonly FactId[] {
  return requireIdentities(value, label, required, requireFactId);
}

export function requireFactActionIds(value: unknown, label: string, required = true): readonly FactActionId[] {
  return requireIdentities(value, label, required, requireFactActionId);
}

function requireIdentities<Identity extends string>(
  value: unknown,
  label: string,
  required: boolean,
  decode: (value: unknown, label: string) => Identity,
): readonly Identity[] {
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw new ShapeValidationError(`${label} must be ${required ? "a non-empty " : "an "}identity array`);
  }
  const identities = value.map((identity, index) => decode(identity, `${label}[${index}]`));
  if (new Set(identities).size !== identities.length) {
    throw new ShapeValidationError(`${label} contains duplicate identities`);
  }
  return identities;
}
