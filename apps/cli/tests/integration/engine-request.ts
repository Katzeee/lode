import { createDesktopClient } from "../../../../packages/desktop-client/src/desktop-client.js";
import { parseEngineCommand, parseEngineQuery } from "../../../../packages/sdk/src/validation.js";

export async function engineRequest(
  operation: "execute" | "query",
  endpoint: string,
  accessToken: string,
  request: unknown,
): Promise<Record<string, unknown>> {
  const client = createDesktopClient(endpoint, accessToken);
  let response: unknown;
  try {
    response =
      operation === "execute"
        ? await client.execute(parseEngineCommand(request))
        : await client.query(parseEngineQuery(request));
  } catch (error) {
    try {
      client.close();
    } catch (cleanupError) {
      const failure = new AggregateError([toError(error), toError(cleanupError)], "Engine request and cleanup failed", {
        cause: error,
      });
      throw failure;
    }
    throw error;
  }
  client.close();
  return record(response, "Engine response");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
