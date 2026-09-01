import { access } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { displayPath, resolveManifestTargets, stronglyConnectedComponents } from "./import-graph.mjs";
import { packageNameFromSpecifier } from "./repository.mjs";

export async function verifyRepositoryArchitecture(repository, graph, packageImports) {
  return [
    ...runtimeCycleDiagnostics(repository, graph),
    ...directoryCycleDiagnostics(repository, graph),
    ...unreachableSourceDiagnostics(repository, graph),
    ...(await staleArchitecturePathDiagnostics(repository)),
    ...packageDependencyDiagnostics(repository, packageImports),
  ];
}

function runtimeCycleDiagnostics(repository, graph) {
  return stronglyConnectedComponents(graph, (edge) => edge.runtime).map((component) => ({
    category: "runtime import cycle",
    details: component
      .sort((left, right) => left.localeCompare(right))
      .map((file) => displayPath(repository.repositoryRoot, file)),
  }));
}

function directoryCycleDiagnostics(repository, graph) {
  const directedBoundaries = new Map();
  for (const [importer, dependencies] of graph) {
    for (const [dependency, edge] of dependencies) {
      const boundary = boundaryBetween(repository, importer, dependency);
      if (boundary === undefined) {
        continue;
      }
      const direction = `${boundary.from}\0${boundary.to}`;
      const examples = directedBoundaries.get(direction) ?? [];
      examples.push({ dependency, edge, importer });
      directedBoundaries.set(direction, examples);
    }
  }

  const diagnostics = [];
  const reported = new Set();
  for (const [direction, forwardEdges] of directedBoundaries) {
    const [from, to] = direction.split("\0");
    const pair = [from, to].sort().join("\0");
    if (reported.has(pair)) {
      continue;
    }
    const reverseEdges = directedBoundaries.get(`${to}\0${from}`);
    if (reverseEdges === undefined) {
      continue;
    }
    reported.add(pair);
    diagnostics.push({
      category: "bidirectional directory dependency",
      details: [
        `${from} -> ${to}: ${formatEdges(repository, forwardEdges)}`,
        `${to} -> ${from}: ${formatEdges(repository, reverseEdges)}`,
      ],
    });
  }
  return diagnostics;
}

function unreachableSourceDiagnostics(repository, graph) {
  const roots = packageEntryRoots(repository);
  const reachable = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const file = pending.pop();
    if (reachable.has(file) || !graph.has(file)) {
      continue;
    }
    reachable.add(file);
    pending.push(...graph.get(file).keys());
  }

  const unreachable = repository.productionFiles
    .filter((file) => !reachable.has(file))
    .map((file) => displayPath(repository.repositoryRoot, file))
    .sort();
  return unreachable.length === 0
    ? []
    : [{ category: "production source unreachable from a package entry", details: unreachable }];
}

async function staleArchitecturePathDiagnostics(repository) {
  const configUrl = pathToFileURL(join(repository.repositoryRoot, "eslint.config.mjs"));
  configUrl.searchParams.set("architecture-verification", String(Date.now()));
  const imported = await import(configUrl.href);
  const patterns = new Set();
  const restrictedImportPatterns = [];
  const restrictedImportRegexes = [];
  for (const config of imported.default ?? []) {
    for (const field of ["files", "ignores"]) {
      for (const pattern of config?.[field] ?? []) {
        if (isRepositorySourcePath(pattern)) {
          patterns.add(pattern);
        }
      }
    }
    for (const pattern of noRestrictedImportGroups(config)) {
      if (isRelativeImportPattern(pattern)) {
        restrictedImportPatterns.push({ config, pattern });
      }
    }
    for (const pattern of noRestrictedImportRegexes(config)) {
      restrictedImportRegexes.push({ config, pattern });
    }
  }

  const stale = new Set();
  const repositoryFiles = repository.repositoryFiles.map((file) => displayPath(repository.repositoryRoot, file));
  for (const pattern of patterns) {
    for (const concretePattern of expandBraceAlternatives(pattern)) {
      if (hasGlobSyntax(concretePattern)) {
        if (!repositoryFiles.some((file) => globMatches(concretePattern, file))) {
          stale.add(concretePattern);
        }
        continue;
      }
      try {
        await access(join(repository.repositoryRoot, concretePattern));
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
        stale.add(concretePattern);
      }
    }
  }
  for (const { config, pattern } of restrictedImportPatterns) {
    const candidates = restrictedImportCandidates(repository, config);
    for (const concretePattern of expandBraceAlternatives(pattern)) {
      if (!candidates.some((candidate) => globMatches(concretePattern, candidate))) {
        stale.add(concretePattern);
      }
    }
  }
  for (const { config, pattern } of restrictedImportRegexes) {
    const candidates = restrictedImportCandidates(repository, config);
    for (const concretePattern of expandRegexLiteralAlternatives(pattern)) {
      const selector = new RegExp(concretePattern);
      if (!candidates.some((candidate) => selector.test(candidate))) {
        stale.add(concretePattern);
      }
    }
  }
  return stale.size === 0
    ? []
    : [{ category: "stale architecture-rule path", details: [...stale].sort() }];
}

function noRestrictedImportGroups(config) {
  const rule = config?.rules?.["no-restricted-imports"];
  const options = Array.isArray(rule) ? rule[1] : undefined;
  const patterns = options !== null && typeof options === "object" ? options.patterns : undefined;
  if (!Array.isArray(patterns)) {
    return [];
  }
  return patterns.flatMap((pattern) =>
    pattern !== null && typeof pattern === "object" && Array.isArray(pattern.group)
      ? pattern.group.filter((value) => typeof value === "string")
      : [],
  );
}

function noRestrictedImportRegexes(config) {
  const rule = config?.rules?.["no-restricted-imports"];
  const options = Array.isArray(rule) ? rule[1] : undefined;
  const patterns = options !== null && typeof options === "object" ? options.patterns : undefined;
  if (!Array.isArray(patterns)) {
    return [];
  }
  return patterns.flatMap((pattern) =>
    pattern !== null && typeof pattern === "object" && typeof pattern.regex === "string"
      ? [pattern.regex]
      : [],
  );
}

function expandRegexLiteralAlternatives(pattern) {
  const group = /\(\?:([A-Za-z0-9_-]+(?:\|[A-Za-z0-9_-]+)+)\)/.exec(pattern);
  if (group === null) {
    return [pattern];
  }
  return group[1]
    .split("|")
    .flatMap((alternative) =>
      expandRegexLiteralAlternatives(`${pattern.slice(0, group.index)}${alternative}${pattern.slice(group.index + group[0].length)}`),
    );
}

function isRelativeImportPattern(pattern) {
  return pattern.startsWith("./") || pattern.startsWith("../") || pattern.startsWith("**/");
}

function restrictedImportCandidates(repository, config) {
  const files = Array.isArray(config.files) ? config.files : ["**/*"];
  const ignores = Array.isArray(config.ignores) ? config.ignores : [];
  const importers = repository.allSourceFiles.filter((file) => {
    const displayed = displayPath(repository.repositoryRoot, file);
    return files.some((pattern) => globMatches(pattern, displayed)) &&
      !ignores.some((pattern) => globMatches(pattern, displayed));
  });
  const candidates = new Set();
  for (const importer of importers) {
    for (const target of repository.allSourceFiles) {
      if (target === importer) {
        continue;
      }
      candidates.add(relativeImportSpecifier(importer, target));
    }
  }
  return [...candidates];
}

function relativeImportSpecifier(importer, target) {
  let specifier = relative(dirname(importer), target).replaceAll("\\", "/");
  if (!specifier.startsWith(".")) {
    specifier = `./${specifier}`;
  }
  const extension = extname(specifier);
  const emittedExtension = extension === ".mts" ? ".mjs" : extension === ".cts" ? ".cjs" : ".js";
  return extension === ".ts" || extension === ".tsx" || extension === ".mts" || extension === ".cts"
    ? `${specifier.slice(0, -extension.length)}${emittedExtension}`
    : specifier;
}

function expandBraceAlternatives(pattern) {
  const open = pattern.indexOf("{");
  if (open === -1) {
    return [pattern];
  }
  const close = pattern.indexOf("}", open + 1);
  if (close === -1) {
    return [pattern];
  }
  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  return pattern
    .slice(open + 1, close)
    .split(",")
    .flatMap((alternative) => expandBraceAlternatives(`${prefix}${alternative}${suffix}`));
}

function packageDependencyDiagnostics(repository, packageImports) {
  const productionFiles = new Set(repository.productionFiles);
  const diagnostics = [];
  for (const workspace of repository.workspaces.values()) {
    const productionImports = importedPackages(packageImports, (file) => productionFiles.has(file) && within(file, workspace.root));
    const testImports = importedPackages(packageImports, (file) => !productionFiles.has(file) && within(file, workspace.root));
    const declaredDependencies = new Set(Object.keys(workspace.manifest.dependencies ?? {}));
    for (const dependency of declaredDependencies) {
      if (productionImports.has(dependency)) {
        continue;
      }
      diagnostics.push({
        category: testImports.has(dependency) ? "package dependency used only by tests" : "unused package dependency",
        details: [`${workspace.name}: ${dependency}`],
      });
    }
    for (const imported of productionImports) {
      if (imported !== workspace.name && !declaredDependencies.has(imported)) {
        diagnostics.push({
          category: "undeclared production dependency",
          details: [`${workspace.name}: ${imported}`],
        });
      }
    }
  }
  return diagnostics;
}

function packageEntryRoots(repository) {
  const fileSet = new Set(repository.productionFiles);
  const roots = new Set();
  for (const workspace of repository.workspaces.values()) {
    for (const target of manifestEntryTargets(workspace.manifest)) {
      for (const root of resolveManifestTargets(workspace, target, [...fileSet])) {
        roots.add(root);
      }
    }
  }
  return roots;
}

function manifestEntryTargets(manifest) {
  const targets = [];
  collectExportTargets(manifest.exports, targets);
  if (typeof manifest.bin === "string") {
    targets.push(manifest.bin);
  } else {
    for (const target of Object.values(manifest.bin ?? {})) {
      if (typeof target === "string") {
        targets.push(target);
      }
    }
  }
  for (const field of ["main", "module"]) {
    if (typeof manifest[field] === "string") {
      targets.push(manifest[field]);
    }
  }
  return targets;
}

function collectExportTargets(value, targets) {
  if (typeof value === "string") {
    targets.push(value);
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "types") {
      continue;
    }
    collectExportTargets(child, targets);
  }
}

function boundaryBetween(repository, importer, dependency) {
  const importerWorkspace = workspaceContaining(repository, importer);
  const dependencyWorkspace = workspaceContaining(repository, dependency);
  if (importerWorkspace === undefined || dependencyWorkspace === undefined) {
    return undefined;
  }
  if (importerWorkspace !== dependencyWorkspace) {
    return { from: importerWorkspace.name, to: dependencyWorkspace.name };
  }

  const sourceDirectory = relative(importerWorkspace.sourceRoot, dirname(importer)).split(sep).filter(Boolean);
  const targetDirectory = relative(importerWorkspace.sourceRoot, dirname(dependency)).split(sep).filter(Boolean);
  let shared = 0;
  while (sourceDirectory[shared] === targetDirectory[shared] && sourceDirectory[shared] !== undefined) {
    shared += 1;
  }
  if (sourceDirectory.length === shared && targetDirectory.length === shared) {
    return undefined;
  }
  return {
    from: directoryBoundaryName(
      importerWorkspace.name,
      sourceDirectory.length === shared ? sourceDirectory : sourceDirectory.slice(0, shared + 1),
    ),
    to: directoryBoundaryName(
      importerWorkspace.name,
      targetDirectory.length === shared ? targetDirectory : targetDirectory.slice(0, shared + 1),
    ),
  };
}

function directoryBoundaryName(workspaceName, segments) {
  return segments.length === 0 ? workspaceName : `${workspaceName}/${segments.join("/")}`;
}

function workspaceContaining(repository, path) {
  return [...repository.workspaces.values()].find((workspace) => within(path, workspace.sourceRoot));
}

function within(path, directory) {
  return path === directory || path.startsWith(`${normalize(directory)}${sep}`);
}

function importedPackages(packageImports, includeFile) {
  const packages = new Set();
  for (const [file, specifiers] of packageImports) {
    if (!includeFile(file)) {
      continue;
    }
    for (const specifier of specifiers) {
      const packageName = packageNameFromSpecifier(specifier);
      if (packageName !== undefined) {
        packages.add(packageName);
      }
    }
  }
  return packages;
}

function isRepositorySourcePath(pattern) {
  return (
    typeof pattern === "string" &&
    pattern.length > 0 &&
    !pattern.startsWith("**/") &&
    !pattern.startsWith("!") &&
    !pattern.startsWith("./") &&
    !pattern.startsWith("../") &&
    !pattern.startsWith("/") &&
    !pattern.startsWith("\\") &&
    !/^[A-Za-z]:/.test(pattern)
  );
}

function hasGlobSyntax(pattern) {
  return /[?*{}[\]!]/.test(pattern);
}

function globMatches(pattern, path) {
  return new RegExp(`^${globRegexSource(pattern)}$`).test(path);
}

function globRegexSource(pattern) {
  let result = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      const followedBySlash = pattern[index + 2] === "/";
      result += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 2 : 1;
      continue;
    }
    if (character === "*") {
      result += "[^/]*";
      continue;
    }
    if (character === "?") {
      result += "[^/]";
      continue;
    }
    if (character === "{") {
      const close = pattern.indexOf("}", index + 1);
      if (close !== -1) {
        result += `(?:${pattern.slice(index + 1, close).split(",").map(escapeRegex).join("|")})`;
        index = close;
        continue;
      }
    }
    result += escapeRegex(character);
  }
  return result;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatEdges(repository, edges) {
  return edges
    .slice(0, 3)
    .map(({ dependency, edge, importer }) => {
      const kind = edge.runtime ? "runtime" : "type-only";
      return `${displayPath(repository.repositoryRoot, importer)} -> ${displayPath(repository.repositoryRoot, dependency)} (${kind})`;
    })
    .join(", ");
}
