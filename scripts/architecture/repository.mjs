import { readdir, readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const SOURCE_EXTENSIONS = new Set([".cts", ".mjs", ".mts", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([".git", "coverage", "dist", "node_modules"]);
const GENERATED_DIRECTORIES = new Set(["dto-gen", "gen"]);

export async function readRepository(repositoryRoot) {
  const [workspaces, repositoryFiles] = await Promise.all([
    discoverWorkspaces(repositoryRoot),
    collectRepositoryFiles(repositoryRoot),
  ]);
  const sourceFiles = [];
  const externalTestFiles = [];
  for (const workspace of workspaces.values()) {
    sourceFiles.push(...(await collectSourceFiles(workspace.sourceRoot)));
    externalTestFiles.push(...(await collectSourceFiles(join(workspace.root, "tests"))));
  }

  const allSourceFiles = [...sourceFiles, ...externalTestFiles];
  const productionFiles = sourceFiles.filter((file) => !isTestSource(file));
  const handwrittenProductionFiles = productionFiles.filter((file) => !isGeneratedSource(file));
  return {
    allSourceFiles,
    handwrittenProductionFiles,
    productionFiles,
    repositoryFiles,
    repositoryRoot,
    workspaces,
  };
}

async function collectRepositoryFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...(await collectRepositoryFiles(join(directory, entry.name))));
      }
    } else if (entry.isFile()) {
      files.push(normalize(join(directory, entry.name)));
    }
  }
  return files;
}

export function isTestSource(path) {
  const normalized = path.replaceAll("\\", "/");
  return /\.(?:test|spec)\.[^.]+$/.test(normalized) || normalized.includes("/tests/");
}

export function packageNameFromSpecifier(specifier) {
  if (
    specifier.startsWith("node:") ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#")
  ) {
    return undefined;
  }
  return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
}

async function discoverWorkspaces(repositoryRoot) {
  const rootManifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  const workspacePatterns = Array.isArray(rootManifest.workspaces) ? rootManifest.workspaces : [];
  const workspaces = new Map();

  for (const pattern of workspacePatterns) {
    if (typeof pattern !== "string" || !pattern.endsWith("/*")) {
      throw new Error(`Unsupported workspace pattern in architecture verifier: ${String(pattern)}`);
    }
    const parent = resolve(repositoryRoot, pattern.slice(0, -2));
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const root = normalize(join(parent, entry.name));
      const manifestPath = join(root, "package.json");
      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        if (typeof manifest.name !== "string") {
          continue;
        }
        workspaces.set(manifest.name, {
          manifest,
          manifestPath: normalize(manifestPath),
          name: manifest.name,
          root,
          sourceRoot: normalize(join(root, "src")),
        });
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
  return workspaces;
}

async function collectSourceFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...(await collectSourceFiles(join(directory, entry.name))));
      }
      continue;
    }
    const path = normalize(join(directory, entry.name));
    if (SOURCE_EXTENSIONS.has(extname(path)) && !path.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files;
}

function isGeneratedSource(path) {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => GENERATED_DIRECTORIES.has(segment));
}
