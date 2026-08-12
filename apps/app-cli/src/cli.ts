import { createAppServerClient } from "@lode/client";
import { runDaemon } from "@lode/daemon";
import { dialTarget } from "@lode/daemon/endpoint";
import type { EngineCommand, EngineQuery } from "@lode/engine";

export async function runCli(
  argv: readonly string[],
  write: (text: string) => void = (text) => process.stdout.write(text),
): Promise<void> {
  if (argv[0] === "daemon" && argv[1] === "run") {
    await runDaemon([...argv.slice(2)]);
    return;
  }
  const operation = argv[0];
  const endpoint = argv[1];
  const payload = argv[2];
  if ((operation !== "execute" && operation !== "query") || !endpoint || !payload) {
    throw new Error(
      "Usage: lode daemon run [flags] | lode execute <endpoint> <command-json> | lode query <endpoint> <query-json>",
    );
  }
  const client = createAppServerClient(dialTarget(endpoint));
  try {
    const value: unknown = JSON.parse(payload);
    const workspaceId = readWorkspaceId(value);
    await client.openWorkspace(workspaceId);
    const result =
      operation === "execute"
        ? await client.engine.execute(value as EngineCommand)
        : await client.engine.query(value as EngineQuery);
    write(`${JSON.stringify(result)}\n`);
  } finally {
    client.close();
  }
}

function readWorkspaceId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("workspaceId" in value) ||
    typeof value.workspaceId !== "string" ||
    value.workspaceId.length === 0
  ) {
    throw new Error("Engine request requires a non-empty workspaceId");
  }
  return value.workspaceId;
}
