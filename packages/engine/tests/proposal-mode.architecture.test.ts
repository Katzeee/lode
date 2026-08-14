import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
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
});

async function source(path: string): Promise<string> {
  return readFile(join(root, path), "utf8");
}
