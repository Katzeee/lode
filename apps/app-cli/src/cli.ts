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
  if (argv[0] === "sync") {
    await syncWorkspace(argv);
    return;
  }
  const operation = argv[0];
  const endpoint = argv[1];
  const payload = argv[2];
  if ((operation !== "execute" && operation !== "query") || !endpoint || !payload) {
    throw new Error(
      "Usage: lode daemon run [flags] | lode execute <endpoint> <command-json> --access-token <token> | lode query <endpoint> <query-json> --access-token <token> | lode sync <endpoint> <workspace-id> <remote-endpoint> --access-token <token>",
    );
  }
  const value: unknown = JSON.parse(payload);
  const workspaceId = readWorkspaceId(value);
  const client = createAppServerClient(dialTarget(endpoint), requiredAccessToken(argv));
  try {
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

async function syncWorkspace(argv: readonly string[]): Promise<void> {
  const endpoint = argv[1];
  const workspaceId = argv[2];
  const remoteEndpoint = argv[3];
  if (!endpoint || !workspaceId || !remoteEndpoint) {
    throw new Error("Usage: lode sync <endpoint> <workspace-id> <remote-endpoint>");
  }
  const client = createAppServerClient(dialTarget(endpoint), requiredAccessToken(argv));
  try {
    await client.openWorkspace(workspaceId);
    await client.syncWorkspace(workspaceId, remoteEndpoint);
  } finally {
    client.close();
  }
}

function requiredAccessToken(argv: readonly string[]): string {
  const index = argv.indexOf("--access-token");
  const token = index < 0 ? process.env.LODE_ACCESS_TOKEN : argv[index + 1];
  if (!token || token.startsWith("--")) {
    throw new Error("App server access token is required via --access-token or LODE_ACCESS_TOKEN");
  }
  return token;
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
