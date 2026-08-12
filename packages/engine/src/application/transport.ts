import type {
  EngineCommand,
  EngineContract,
  EngineQuery,
  EngineQueryResult,
  Unsubscribe,
  WriteResult,
} from "./contract.js";
import { parseEngineCommand, parseEngineQuery } from "./input-validation.js";
import { deliverListeners } from "./event-delivery.js";
import { parseEngineEvent, parseEngineQueryResult, parseWriteResult } from "./output-validation.js";

export type EngineTransport = Readonly<{
  request(bytes: Uint8Array): Promise<Uint8Array>;
  subscribe?(listener: (bytes: Uint8Array) => void): Unsubscribe;
}>;

type TransportRequest =
  | Readonly<{ kind: "command"; command: EngineCommand }>
  | Readonly<{ kind: "query"; query: EngineQuery }>;

type TransportResponse =
  | Readonly<{ kind: "write-result"; result: WriteResult }>
  | Readonly<{ kind: "query-result"; result: EngineQueryResult }>;

export function createEngineTransportServer(contract: EngineContract): EngineTransport {
  const eventListeners = new Set<(bytes: Uint8Array) => void>();
  contract.subscribe((event) => {
    const bytes = encode(event);
    deliverListeners(eventListeners, bytes, (value) => value.slice());
  });
  return {
    async request(bytes) {
      let request: TransportRequest;
      try {
        request = parseTransportRequest(decode(bytes));
      } catch (error) {
        return encode({ kind: "write-result", result: invalidWrite(error) });
      }
      if (request.kind === "command") {
        return encode({ kind: "write-result", result: await contract.execute(request.command) });
      }
      return encode({ kind: "query-result", result: await contract.query(request.query) });
    },
    subscribe(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };
}

export function createTransportEngineContract(transport: EngineTransport): EngineContract {
  return {
    async execute(command) {
      let bytes: Uint8Array;
      try {
        bytes = encode({ kind: "command", command: parseEngineCommand(command) });
      } catch (error) {
        return invalidWrite(error);
      }
      try {
        const response = parseTransportResponse(decode(await transport.request(bytes)));
        if (response.kind !== "write-result") {
          throw new Error("Transport returned a query result for a command");
        }
        return response.result;
      } catch {
        return { status: "outcome-unknown", invocationId: command.invocationId };
      }
    },
    async query(query) {
      let bytes: Uint8Array;
      try {
        bytes = encode({ kind: "query", query: parseEngineQuery(query) });
      } catch (error) {
        return { status: "rejected", error: invalidError(error) };
      }
      try {
        const response = parseTransportResponse(decode(await transport.request(bytes)));
        if (response.kind !== "query-result") {
          throw new Error("Transport returned a write result for a query");
        }
        return response.result;
      } catch (error) {
        return {
          status: "rejected",
          error: {
            code: "projection-unavailable",
            message: error instanceof Error ? error.message : String(error),
            currentGenerationId: null,
          },
        };
      }
    },
    subscribe(listener) {
      return (
        transport.subscribe?.((bytes) => {
          try {
            listener(parseEngineEvent(decode(bytes)));
          } catch {
            /* Corrupt events are isolated. */
          }
        }) ?? (() => {})
      );
    },
  };
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function decode(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function parseTransportRequest(value: unknown): TransportRequest {
  const envelope = object(value, "transport request");
  if (envelope.kind === "command") {
    exactKeys(envelope, ["kind", "command"]);
    return { kind: "command", command: parseEngineCommand(envelope.command) };
  }
  if (envelope.kind === "query") {
    exactKeys(envelope, ["kind", "query"]);
    return { kind: "query", query: parseEngineQuery(envelope.query) };
  }
  throw new Error("Unknown transport request kind");
}

function parseTransportResponse(value: unknown): TransportResponse {
  const envelope = object(value, "transport response");
  if (envelope.kind === "write-result") {
    exactKeys(envelope, ["kind", "result"]);
    return { kind: "write-result", result: parseWriteResult(envelope.result) };
  }
  if (envelope.kind === "query-result") {
    exactKeys(envelope, ["kind", "result"]);
    return { kind: "query-result", result: parseEngineQueryResult(envelope.result) };
  }
  throw new Error("Unknown transport response kind");
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknownKey = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknownKey || Object.keys(value).length !== allowed.length) {
    throw new Error("Transport envelope has unknown or missing fields");
  }
}

function invalidWrite(error: unknown): WriteResult {
  return { status: "rejected", error: invalidError(error) };
}

function invalidError(error: unknown) {
  return {
    code: "invalid-input" as const,
    message: error instanceof Error ? error.message : String(error),
    currentGenerationId: null,
  };
}
