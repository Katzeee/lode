import { createDesktopClient, describeError } from "@lode/desktop-client";
import { parseEngineCommand, parseEngineQuery } from "@lode/sdk";

/**
 * Diagnostic Commands: raw `execute`/`query` access for development against
 * the formal contract. These are not product commands, are excluded from
 * product help and acceptance, and may print raw Engine JSON.
 */

export { describeError };

export async function runDiagnosticCli(
  argv: readonly string[],
  write: (text: string) => void,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const operation = argv[0];
  const endpoint = argv[1];
  const payload = argv[2];
  if ((operation !== "execute" && operation !== "query") || !endpoint || !payload) {
    throw new Error(
      "Usage: lode execute <endpoint> <command-json> --access-token <token> | lode query <endpoint> <query-json> --access-token <token>",
    );
  }
  const value: unknown = JSON.parse(payload);
  const client = createDesktopClient(endpoint, requiredAccessToken(argv, environment));
  try {
    if (operation === "execute") {
      const command = parseEngineCommand(value);
      write(`${JSON.stringify(await client.execute(command))}\n`);
    } else {
      const query = parseEngineQuery(value);
      write(`${JSON.stringify(await client.query(query))}\n`);
    }
  } finally {
    client.close();
  }
}

function requiredAccessToken(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const index = argv.indexOf("--access-token");
  const token = index < 0 ? environment.LODE_ACCESS_TOKEN : argv[index + 1];
  if (!token || token.startsWith("--")) {
    throw new Error("Desktop daemon access token is required via --access-token or LODE_ACCESS_TOKEN");
  }
  return token;
}
