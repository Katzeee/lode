import {
  decodeEngineCommand,
  decodeEngineQuery,
  encodeEngineEvent,
  encodeEngineQueryError,
  encodeEngineQueryResult,
  encodeWriteResult,
  type EngineApplicationContract,
  type EngineTransport,
} from "@lode/sdk";

import { deliverListeners } from "../../src/application/event-delivery.js";
import { parseEngineCommand, parseEngineQuery } from "../../src/application/input-validation.js";

export function createEngineTransportServer(contract: EngineApplicationContract): EngineTransport {
  const eventListeners = new Set<(bytes: Uint8Array) => void>();
  contract.subscribe((event) => {
    const bytes = encodeEngineEvent(event);
    deliverListeners(eventListeners, bytes, (value) => value.slice());
  });
  return {
    async execute(bytes) {
      try {
        const command = parseEngineCommand(decodeEngineCommand(bytes));
        return encodeWriteResult(await contract.execute(command));
      } catch (error) {
        return encodeWriteResult(invalidWrite(error));
      }
    },
    async query(bytes) {
      try {
        const query = parseEngineQuery(decodeEngineQuery(bytes));
        return encodeEngineQueryResult(query, await contract.query(query));
      } catch (error) {
        return encodeEngineQueryError(invalidError(error));
      }
    },
    subscribe(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };
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
