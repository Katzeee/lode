import { stableStringCompare } from "../fact/index.js";

export type SchemaExtensionGraph = Readonly<{
  searchMembers: Readonly<Record<string, readonly string[]>>;
  conflicts: Readonly<Record<string, readonly string[]>>;
  lineage(schemaId: string): readonly string[];
}>;

export function schemaExtensionGraph(extensions: Readonly<Record<string, readonly string[]>>): SchemaExtensionGraph {
  const cyclic = cyclicSchemas(extensions);
  return {
    searchMembers: searchMembers(extensions, cyclic),
    conflicts: extensionConflicts(extensions, cyclic),
    lineage: (schemaId) => lineage(schemaId, extensions, cyclic),
  };
}

function searchMembers(
  extensions: Readonly<Record<string, readonly string[]>>,
  cyclic: ReadonlySet<string>,
): Readonly<Record<string, readonly string[]>> {
  const schemas = schemaIdentities(extensions);
  return Object.fromEntries(
    [...schemas]
      .sort(stableStringCompare)
      .map((baseSchemaId) => [
        baseSchemaId,
        [...schemas]
          .filter(
            (schemaId) => schemaId === baseSchemaId || lineage(schemaId, extensions, cyclic).includes(baseSchemaId),
          )
          .sort(stableStringCompare),
      ]),
  );
}

function extensionConflicts(
  extensions: Readonly<Record<string, readonly string[]>>,
  cyclic: ReadonlySet<string>,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    [...cyclic]
      .sort(stableStringCompare)
      .map((schemaId) => [
        schemaId,
        [...cyclic]
          .filter((candidate) => reaches(extensions, schemaId, candidate) && reaches(extensions, candidate, schemaId))
          .sort(stableStringCompare),
      ]),
  );
}

function lineage(
  schemaId: string,
  extensions: Readonly<Record<string, readonly string[]>>,
  cyclic: ReadonlySet<string>,
  visited: ReadonlySet<string> = new Set(),
): readonly string[] {
  if (visited.has(schemaId) || cyclic.has(schemaId)) {
    return [schemaId];
  }
  const result: string[] = [];
  const nextVisited = new Set([...visited, schemaId]);
  for (const baseSchemaId of extensions[schemaId] ?? []) {
    if (cyclic.has(baseSchemaId)) {
      continue;
    }
    for (const inherited of lineage(baseSchemaId, extensions, cyclic, nextVisited)) {
      appendUnique(result, inherited);
    }
  }
  appendUnique(result, schemaId);
  return result;
}

function cyclicSchemas(extensions: Readonly<Record<string, readonly string[]>>): ReadonlySet<string> {
  return new Set([...schemaIdentities(extensions)].filter((schemaId) => reaches(extensions, schemaId, schemaId)));
}

function schemaIdentities(extensions: Readonly<Record<string, readonly string[]>>): ReadonlySet<string> {
  return new Set([...Object.keys(extensions), ...Object.values(extensions).flat()]);
}

function reaches(
  extensions: Readonly<Record<string, readonly string[]>>,
  from: string,
  target: string,
  visited: ReadonlySet<string> = new Set(),
): boolean {
  if (visited.has(from)) {
    return false;
  }
  const nextVisited = new Set([...visited, from]);
  return (extensions[from] ?? []).some((base) => base === target || reaches(extensions, base, target, nextVisited));
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}
