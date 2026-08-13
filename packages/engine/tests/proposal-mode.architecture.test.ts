import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const engineSource = join(root, "packages/engine/src");

describe("Proposal Mode architecture boundaries", () => {
  it("CMD-1 app capability exposes only the typed engine contract", async () => {
    const runtime = await source("packages/engine/src/engine-runtime.ts");
    const entry = await source("packages/engine/src/index.ts");
    expect(runtime).toContain("engine: EngineContract");
    expect(runtime).not.toContain("FactAuthority");
    expect(entry).not.toMatch(/FactAuthority|ProposalWorkspace|FactAuthorityStore|Materializer/);
    expect(entry).not.toMatch(/createEngineRuntime|EngineRuntime|SyncTransport|AppRuntime/);
    const serverEntry = await source("packages/engine/src/server.ts");
    expect(serverEntry).toContain("createEngineRuntime");
    expect(serverEntry).toContain("SyncTransport");
    const packageManifest = JSON.parse(await source("packages/engine/package.json")) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(packageManifest.exports)).toEqual([".", "./server"]);
    const clientEntry = await source("packages/ipc/client/src/index.ts");
    expect(clientEntry).toContain("createAppServerClient");
    expect(clientEntry).not.toMatch(/createSocketTransport|AppServerTransport|LodeCommandsClient/);
  });

  it("the mutable Engine sharded authority snapshot history and old command surface are absent", async () => {
    const sourceFiles = (await typeScriptFiles(engineSource)).map(relativeEngine);
    expect(sourceFiles.some((file) => file.startsWith("core/"))).toBe(false);
    expect(sourceFiles.some((file) => file.startsWith("commands/"))).toBe(false);
    expect(await exists("packages/engine/src/core/action-history.ts")).toBe(false);
    expect(await exists("packages/engine/src/core/store/sharded-store.ts")).toBe(false);
  });

  it("Loro is confined to the Fact replication adapter and protobuf to transport adapters", async () => {
    const files = (await typeScriptFiles(engineSource)).filter(
      (file) => !file.endsWith(".test.ts"),
    );
    const loroImports: string[] = [];
    const protobufImports: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (text.includes('from "loro-crdt"')) {
        loroImports.push(relativeEngine(file));
      }
      if (text.includes("@lode/protocol") || text.includes("@bufbuild")) {
        protobufImports.push(relativeEngine(file));
      }
    }
    expect(loroImports.sort()).toEqual([
      "runtime/authority/fact-sync-projection.ts",
      "runtime/authority/loro-fact-replica-state.ts",
      "runtime/authority/loro-fact-replica.ts",
      "runtime/authority/sync-import-validation.ts",
    ]);
    expect(protobufImports).toEqual([]);
  });

  it("SYNC-1 the only domain sync document is the Fact authority document", async () => {
    const composite = await source("packages/engine/src/runtime/sync/fact-sync.ts");
    expect(composite).toContain("return [this.facts]");
    expect(composite).not.toMatch(/projection|checkpoint|material/i);
  });

  it("workspace orchestration does not import sync composition", async () => {
    const files = (await typeScriptFiles(join(engineSource, "runtime/workspace"))).filter(
      (file) => !file.endsWith(".test.ts"),
    );
    for (const file of files) {
      expect(await readFile(file, "utf8")).not.toMatch(/from "\.\.\/sync\//);
    }
  });

  it("pure Reconcile is checkpoint-neutral and workspace retains only generation identity", async () => {
    const reconcileFiles = (await typeScriptFiles(join(engineSource, "domain/reconcile"))).filter(
      (file) => !file.endsWith(".test.ts"),
    );
    for (const file of reconcileFiles) {
      expect(relativeEngine(file)).not.toMatch(/checkpoint/i);
      expect(await readFile(file, "utf8")).not.toMatch(/GenerationCheckpoint|checkpoint-shape/);
    }
    const workspace = await source("packages/engine/src/runtime/workspace/proposal-workspace.ts");
    expect(workspace).toContain("generationIdentity");
    expect(workspace).not.toMatch(/private generation: ProjectionGeneration/);
  });

  it("production scope contains no skipped tests placeholders or unresolved TODOs", async () => {
    const roots = [
      engineSource,
      join(root, "packages/ipc/client/src"),
      join(root, "packages/ipc/daemon/src"),
      join(root, "packages/protocol/protos"),
    ];
    const violations: string[] = [];
    for (const directory of roots) {
      for (const file of await textFiles(directory)) {
        const text = await readFile(file, "utf8");
        if (/\b(?:it|test|describe)\.skip\b|\bTODO\b|IMPLEMENTATION_PLACEHOLDER/.test(text)) {
          violations.push(file.slice(root.length + 1));
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

async function source(path: string): Promise<string> {
  return readFile(join(root, path), "utf8");
}

async function exists(path: string): Promise<boolean> {
  return readFile(join(root, path)).then(
    () => true,
    () => false,
  );
}

async function typeScriptFiles(directory: string): Promise<string[]> {
  return (await textFiles(directory)).filter((file) => file.endsWith(".ts"));
}

async function textFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await textFiles(path)));
    } else if (/\.(?:ts|proto)$/.test(entry.name)) {
      result.push(path);
    }
  }
  return result.sort();
}

function relativeEngine(file: string): string {
  return file.slice(engineSource.length + 1).replaceAll("\\", "/");
}
