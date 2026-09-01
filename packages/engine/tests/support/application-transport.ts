import { type EngineApplicationContract, type EngineTransport } from "@lode/sdk";
import {
  engineCommandFromMessage,
  engineEventToMessage,
  engineQueryFromMessage,
  queryResultToMessage,
  writeResultToMessage,
} from "@lode/sdk/host";

import { parseEngineCommand, parseEngineQuery } from "../../src/subsystems/workspace/application/input-validation.js";

/**
 * Serves an application contract behind the SDK transport seam, forcing every
 * command, query, and event through the protocol message conversion a real
 * host performs on each side of the wire.
 */
export function createEngineTransportServer(contract: EngineApplicationContract): EngineTransport {
  const eventListeners = new Set<Parameters<EngineTransport["subscribe"]>[0]>();
  contract.subscribe((event) => {
    const message = engineEventToMessage(event);
    for (const listener of eventListeners) {
      try {
        listener(message);
      } catch {
        continue;
      }
    }
  }, rethrow);
  return {
    async execute(message) {
      let command: ReturnType<typeof parseEngineCommand>;
      try {
        command = parseEngineCommand(engineCommandFromMessage(message));
      } catch (error) {
        return { status: "response", message: writeResultToMessage(invalidWrite(error)) };
      }
      return { status: "response", message: writeResultToMessage(await contract.execute(command)) };
    },
    async query(message) {
      const decoded = engineQueryFromMessage(message);
      let query: ReturnType<typeof parseEngineQuery>;
      try {
        query = parseEngineQuery(decoded);
      } catch (error) {
        return queryResultToMessage(decoded, { status: "rejected", error: invalidError(error) });
      }
      return queryResultToMessage(query, await contract.query(query));
    },
    subscribe(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };
}

function rethrow(error: unknown): never {
  throw error;
}

function invalidWrite(error: unknown) {
  return {
    status: "rejected" as const,
    error: invalidError(error),
  };
}

function invalidError(error: unknown) {
  return {
    code: "invalid-input" as const,
    message: error instanceof Error ? error.message : String(error),
    currentGenerationId: null,
  };
}
