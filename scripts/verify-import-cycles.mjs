import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import ts from "typescript";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceRoots = [join(repositoryRoot, "packages"), join(repositoryRoot, "apps")];
const sourceExtensions = new Set([".ts", ".tsx", ".mjs"]);
const ignoredDirectories = new Set(["dist", "node_modules"]);
const workspacePackages = await discoverWorkspacePackages();

const files = (await Promise.all(sourceRoots.map((root) => collect(root)))).flat();
const forbiddenOwnerFiles = files.filter((file) =>
  display(file).toLowerCase().startsWith("packages/engine/src/runtime/"),
);
if (forbiddenOwnerFiles.length > 0) {
  console.error("Engine-owned implementation cannot live in a parallel runtime tree:");
  for (const file of forbiddenOwnerFiles) {
    console.error(`  ${display(file)}`);
  }
  process.exit(1);
}
const fileSet = new Set(files.map(normalize));
const graph = new Map();

for (const file of files) {
  const source = await readFile(file, "utf8");
  const dependencies = importSpecifiers(source, file)
    .map((specifier) => resolveImport(file, specifier))
    .filter((dependency) => dependency !== undefined);
  graph.set(normalize(file), dependencies);
}

const visiting = new Map();
const visited = new Set();
const cycles = new Map();

for (const file of graph.keys()) {
  visit(file, []);
}

const architectureCycles = [...cycles.values()].filter(
  (cycle) => cycle.some(isOwnershipBoundary) || isCrossPackageCycle(cycle),
);

if (architectureCycles.length > 0) {
  console.error("Production ownership-boundary or cross-package import cycles detected:");
  for (const cycle of architectureCycles) {
    console.error(`  ${cycle.map(display).join(" -> ")}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Verified ${files.length} production source files: no ownership-boundary or cross-package import cycles.`,
  );
}

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const collected = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        collected.push(...(await collect(join(directory, entry.name))));
      }
      continue;
    }
    const path = join(directory, entry.name);
    if (isProductionSource(path)) {
      collected.push(normalize(path));
    }
  }
  return collected;
}

function isProductionSource(path) {
  return sourceExtensions.has(extname(path)) && !/\.(?:test|spec)\.[^.]+$/.test(path) && !path.endsWith(".d.ts");
}

function importSpecifiers(source, path) {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false);
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length >= 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function resolveImport(importer, specifier) {
  if (!specifier.startsWith(".")) {
    return resolveWorkspaceImport(specifier);
  }
  const requested = resolve(dirname(importer), specifier);
  const extension = extname(requested);
  const candidates = extension
    ? [requested.slice(0, -extension.length) + ".ts", requested.slice(0, -extension.length) + ".tsx", requested]
    : [requested + ".ts", requested + ".tsx", requested + ".mjs", join(requested, "index.ts")];
  return candidates.map(normalize).find((candidate) => fileSet.has(candidate));
}

function resolveWorkspaceImport(specifier) {
  const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  const workspacePackage = workspacePackages.get(packageName);
  if (!workspacePackage) {
    return undefined;
  }
  const subpath = specifier === packageName ? "." : `.${specifier.slice(packageName.length)}`;
  for (const [exportPath, target] of Object.entries(workspacePackage.exports)) {
    const wildcard = exportPath.includes("*");
    const match = wildcard
      ? new RegExp(`^${escapeRegex(exportPath).replace("\\*", "(.+)")}$`).exec(subpath)
      : exportPath === subpath
        ? [subpath]
        : null;
    if (!match) {
      continue;
    }
    const exported = typeof target === "string" ? target : (target.import ?? target.types);
    if (typeof exported !== "string") {
      return undefined;
    }
    const resolvedTarget = wildcard ? exported.replace("*", match[1]) : exported;
    const sourcePath = resolvedTarget.replace(/^\.\/dist\//, "src/").replace(/\.(?:d\.)?js$/, ".ts");
    const candidate = normalize(join(workspacePackage.root, sourcePath));
    return fileSet.has(candidate) ? candidate : undefined;
  }
  return undefined;
}

function visit(file, stack) {
  if (visited.has(file)) {
    return;
  }
  const stackIndex = visiting.get(file);
  if (stackIndex !== undefined) {
    const cycle = [...stack.slice(stackIndex), file];
    const key = canonicalCycle(cycle.slice(0, -1));
    cycles.set(key, cycle);
    return;
  }
  visiting.set(file, stack.length);
  const nextStack = [...stack, file];
  for (const dependency of graph.get(file) ?? []) {
    visit(dependency, nextStack);
  }
  visiting.delete(file);
  visited.add(file);
}

function canonicalCycle(cycle) {
  return cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)].map(display).join(" -> ")).sort()[0];
}

function display(path) {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

function isOwnershipBoundary(path) {
  const repositoryPath = display(path);
  return (
    repositoryPath === "packages/engine/src/engine.ts" ||
    repositoryPath === "packages/engine/src/host.ts" ||
    repositoryPath.startsWith("packages/engine/src/subsystems/") ||
    repositoryPath.startsWith("packages/daemon/src/")
  );
}

function isCrossPackageCycle(cycle) {
  return new Set(cycle.map(packageRootOf).filter((root) => root !== undefined)).size > 1;
}

function packageRootOf(path) {
  return [...workspacePackages.values()].find(({ root }) => path.startsWith(`${normalize(root)}${sep}`))?.root;
}

async function discoverWorkspacePackages() {
  const discovered = new Map();
  for (const workspaceRoot of sourceRoots) {
    for (const entry of await readdir(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const root = join(workspaceRoot, entry.name);
      try {
        const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
        if (typeof manifest.name === "string") {
          discovered.set(manifest.name, { root, exports: manifest.exports ?? {} });
        }
      } catch {
        // A source directory without a package manifest is not a workspace package.
      }
    }
  }
  return discovered;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
