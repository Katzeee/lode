export type FactId = `g${number}/${string}/${string}/${number}`;
export type FactActionId = `${FactId}/actions/${number}`;

const FACT_ID_PATTERN = /^g\d+\/.+\/(?:0|[1-9]\d*)\/(?:0|[1-9]\d*)$/;
const FACT_ACTION_ID_PATTERN = /^g\d+\/.+\/(?:0|[1-9]\d*)\/(?:0|[1-9]\d*)\/actions\/(?:0|[1-9]\d*)$/;

export function factIds(value: unknown, label: string, required = true): readonly FactId[] {
  return identities(value, label, required, FACT_ID_PATTERN) as readonly FactId[];
}

export function factActionIds(value: unknown, label: string, required = true): readonly FactActionId[] {
  return identities(value, label, required, FACT_ACTION_ID_PATTERN) as readonly FactActionId[];
}

export function factActionId(value: unknown, label: string): FactActionId {
  const [identity] = factActionIds([value], label);
  if (identity === undefined) {
    throw new Error(`${label} must be a FactAction identity`);
  }
  return identity;
}

function identities(value: unknown, label: string, required: boolean, pattern: RegExp): readonly string[] {
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw new Error(`${label} must be ${required ? "a non-empty " : "an "}identity array`);
  }
  const result = value.map((item) => {
    if (typeof item !== "string" || !pattern.test(item)) {
      throw new Error(`${label} contains an invalid identity`);
    }
    return item;
  });
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} contains duplicate identities`);
  }
  return result;
}
