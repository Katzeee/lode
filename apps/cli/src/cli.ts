import { createDesktopClient } from "@lode/desktop-client";
import { parseEngineCommand, parseEngineQuery } from "@lode/sdk";
import { runDomainCommand } from "./domain-cli.js";

export async function runCli(
  argv: readonly string[],
  write: (text: string) => void = (text) => process.stdout.write(text),
): Promise<void> {
  if (argv[0] === "sync") {
    const result = await syncWorkspace(argv);
    write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (argv[0] === "domain") {
    const endpoint = argv[1];
    const workspaceId = argv[2];
    if (!endpoint || !workspaceId || !argv[3]) {
      throw new Error("Usage: lode domain <endpoint> <workspace-id> <action> [arguments] --access-token <token>");
    }
    const client = createDesktopClient(endpoint, requiredAccessToken(argv));
    try {
      await client.openWorkspace(workspaceId);
      const result = await runDomainCommand(client, workspaceId, argv.slice(3));
      write(`${JSON.stringify(result)}\n`);
    } finally {
      client.close();
    }
    return;
  }
  const operation = argv[0];
  const endpoint = argv[1];
  const payload = argv[2];
  if ((operation !== "execute" && operation !== "query") || !endpoint || !payload) {
    throw new Error(
      "Usage: lode domain <endpoint> <workspace-id> <action> [arguments] --access-token <token> | lode execute <endpoint> <command-json> --access-token <token> | lode query <endpoint> <query-json> --access-token <token> | lode sync <endpoint> <workspace-id> <remote-endpoint> --access-token <token>",
    );
  }
  const value: unknown = JSON.parse(payload);
  const result =
    operation === "execute"
      ? await execute(endpoint, argv, parseEngineCommand(value))
      : await query(endpoint, argv, parseEngineQuery(value));
  write(`${JSON.stringify(result)}\n`);
}

async function execute(endpoint: string, argv: readonly string[], command: ReturnType<typeof parseEngineCommand>) {
  const client = createDesktopClient(endpoint, requiredAccessToken(argv));
  try {
    await client.openWorkspace(command.workspaceId);
    return await client.execute(command);
  } finally {
    client.close();
  }
}

async function query(endpoint: string, argv: readonly string[], request: ReturnType<typeof parseEngineQuery>) {
  const client = createDesktopClient(endpoint, requiredAccessToken(argv));
  try {
    await client.openWorkspace(request.workspaceId);
    return await client.query(request);
  } finally {
    client.close();
  }
}

async function syncWorkspace(argv: readonly string[]): Promise<Readonly<Record<string, unknown>>> {
  const endpoint = argv[1];
  const workspaceId = argv[2];
  const remoteEndpoint = argv[3];
  if (!endpoint || !workspaceId || !remoteEndpoint) {
    throw new Error("Usage: lode sync <endpoint> <workspace-id> <remote-endpoint>");
  }
  const client = createDesktopClient(endpoint, requiredAccessToken(argv));
  try {
    await client.openWorkspace(workspaceId);
    await client.syncWorkspace(workspaceId, remoteEndpoint);
    return { status: "ok", value: { workspaceId, endpoint, remoteEndpoint } };
  } finally {
    client.close();
  }
}

function requiredAccessToken(argv: readonly string[]): string {
  const index = argv.indexOf("--access-token");
  const token = index < 0 ? process.env.LODE_ACCESS_TOKEN : argv[index + 1];
  if (!token || token.startsWith("--")) {
    throw new Error("Desktop daemon access token is required via --access-token or LODE_ACCESS_TOKEN");
  }
  return token;
}
