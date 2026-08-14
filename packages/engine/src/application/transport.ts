import type {
  EngineCommand,
  EngineContract,
  EngineQuery,
  EngineQueryForKind,
  EngineQueryInput,
  EngineQueryKind,
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
  async function query<Kind extends EngineQueryKind>(
    query: EngineQueryInput<Kind>,
  ): Promise<EngineQueryResult<EngineQueryForKind<Kind>>>;
  async function query(query: EngineQuery): Promise<EngineQueryResult> {
    let parsed: EngineQuery;
    let bytes: Uint8Array;
    try {
      parsed = parseEngineQuery(query);
      bytes = encode({ kind: "query", query: parsed });
    } catch (error) {
      return { status: "rejected", error: invalidError(error) };
    }
    try {
      return parseTransportQueryResponse(decode(await transport.request(bytes)), parsed);
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
  }
  return {
    async execute(command) {
      let bytes: Uint8Array;
      try {
        bytes = encode({ kind: "command", command: parseEngineCommand(command) });
      } catch (error) {
        return invalidWrite(error);
      }
      try {
        return parseTransportWriteResponse(decode(await transport.request(bytes)));
      } catch {
        return { status: "outcome-unknown", invocationId: command.invocationId };
      }
    },
    query,
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

function parseTransportWriteResponse(value: unknown): WriteResult {
  const envelope = object(value, "transport response");
  exactKeys(envelope, ["kind", "result"]);
  if (envelope.kind !== "write-result") {
    throw new Error("Transport returned a query result for a command");
  }
  return parseWriteResult(envelope.result);
}

function parseTransportQueryResponse<Query extends EngineQuery>(
  value: unknown,
  query: Query,
): EngineQueryResult<Query> {
  const envelope = object(value, "transport response");
  exactKeys(envelope, ["kind", "result"]);
  if (envelope.kind !== "query-result") {
    throw new Error("Transport returned a write result for a query");
  }
  return parseEngineQueryResult(envelope.result, query);
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
