import { stableStringCompare } from "../fact/index.js";

export type SupertagExtensionGraph = Readonly<{
  instanceSupertags: Readonly<Record<string, readonly string[]>>;
  conflicts: Readonly<Record<string, readonly string[]>>;
  lineage(supertagId: string): readonly string[];
  paths(supertagId: string): readonly (readonly string[])[];
}>;

export function supertagExtensionGraph(
  extensions: Readonly<Record<string, readonly string[]>>,
): SupertagExtensionGraph {
  const cyclic = cyclicSupertags(extensions);
  return {
    instanceSupertags: instanceSupertags(extensions, cyclic),
    conflicts: extensionConflicts(extensions, cyclic),
    lineage: (supertagId) => lineage(supertagId, extensions, cyclic),
    paths: (supertagId) => extensionPaths(supertagId, extensions, cyclic),
  };
}

function extensionPaths(
  supertagId: string,
  extensions: Readonly<Record<string, readonly string[]>>,
  cyclic: ReadonlySet<string>,
  visited: ReadonlySet<string> = new Set(),
): readonly (readonly string[])[] {
  if (cyclic.has(supertagId)) {
    return [[supertagId]];
  }
  const result: string[][] = [[supertagId]];
  const nextVisited = new Set([...visited, supertagId]);
  for (const baseSupertagId of extensions[supertagId] ?? []) {
    if (nextVisited.has(baseSupertagId) || cyclic.has(baseSupertagId)) {
      continue;
    }
    for (const path of extensionPaths(baseSupertagId, extensions, cyclic, nextVisited)) {
      result.push([supertagId, ...path]);
    }
  }
  return result;
}

function instanceSupertags(
  extensions: Readonly<Record<string, readonly string[]>>,
  cyclic: ReadonlySet<string>,
): Readonly<Record<string, readonly string[]>> {
  const supertags = supertagIdentities(extensions);
  return Object.fromEntries(
    [...supertags]
      .sort(stableStringCompare)
      .map((baseSupertagId) => [
        baseSupertagId,
        [...supertags]
          .filter(
            (supertagId) =>
              supertagId === baseSupertagId || lineage(supertagId, extensions, cyclic).includes(baseSupertagId),
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
      .map((supertagId) => [
        supertagId,
        [...cyclic]
          .filter(
            (candidate) => reaches(extensions, supertagId, candidate) && reaches(extensions, candidate, supertagId),
          )
          .sort(stableStringCompare),
      ]),
  );
}

function lineage(
  supertagId: string,
  extensions: Readonly<Record<string, readonly string[]>>,
  cyclic: ReadonlySet<string>,
  visited: ReadonlySet<string> = new Set(),
): readonly string[] {
  if (visited.has(supertagId) || cyclic.has(supertagId)) {
    return [supertagId];
  }
  const result: string[] = [];
  const nextVisited = new Set([...visited, supertagId]);
  for (const baseSupertagId of extensions[supertagId] ?? []) {
    if (cyclic.has(baseSupertagId)) {
      continue;
    }
    for (const inherited of lineage(baseSupertagId, extensions, cyclic, nextVisited)) {
      appendUnique(result, inherited);
    }
  }
  appendUnique(result, supertagId);
  return result;
}

function cyclicSupertags(extensions: Readonly<Record<string, readonly string[]>>): ReadonlySet<string> {
  return new Set(
    [...supertagIdentities(extensions)].filter((supertagId) => reaches(extensions, supertagId, supertagId)),
  );
}

function supertagIdentities(extensions: Readonly<Record<string, readonly string[]>>): ReadonlySet<string> {
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
