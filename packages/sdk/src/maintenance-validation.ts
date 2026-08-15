export function validateHardDeleteSelection(value: unknown): void {
  const selection = record(value, "Hard Delete selection");
  exact(selection, [
    "workspaceId",
    "frontier",
    "nodeId",
    "deletionFactIds",
    "acknowledgementFactIds",
    "retiredReplicaIds",
  ]);
  nonempty(selection.workspaceId, "Hard Delete Workspace identity");
  factFrontier(selection.frontier);
  nonempty(selection.nodeId, "Hard Delete Node identity");
  identities(selection.deletionFactIds, "Deletion Fact identities", true);
  identities(selection.acknowledgementFactIds, "Acknowledgement Fact identities", true);
  identities(selection.retiredReplicaIds, "Retired Replica identities", false);
}

function factFrontier(value: unknown): void {
  const frontier = record(value, "Fact frontier");
  for (const [replicaId, sequence] of Object.entries(frontier)) {
    if (!/^[a-z2-7]{26}$/.test(replicaId) || !Number.isSafeInteger(sequence) || (sequence as number) < 0) {
      throw new Error("Fact frontier is invalid");
    }
  }
}

function identities(value: unknown, label: string, required: boolean): void {
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw new Error(`${label} must be ${required ? "a non-empty " : "an "}identity array`);
  }
  const result = value.map((item) => nonempty(item, label));
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} contains duplicate identities`);
  }
}

function exact(value: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) {
    throw new Error(`Unknown input field: ${extra}`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}
