import type {
  EngineCommand,
  EngineApplicationContract,
  EngineEvent,
  EngineQuery,
  EngineQueryForKind,
  EngineQueryInput,
  EngineQueryKind,
  EngineQueryResult,
  Unsubscribe,
} from "./contract.js";
import {
  decodeEngineEvent,
  decodeEngineQueryResult,
  decodeWriteResult,
  encodeEngineCommand,
  encodeEngineQuery,
} from "./protocol-codec.js";
import { parseEngineCommand, parseEngineQuery } from "./validation.js";

export type EngineTransport = Readonly<{
  execute(bytes: Uint8Array): Promise<Uint8Array>;
  query(bytes: Uint8Array): Promise<Uint8Array>;
  subscribe?(listener: (bytes: Uint8Array) => void): Unsubscribe;
}>;

export function createTransportEngineApplication(transport: EngineTransport): EngineApplicationContract {
  async function query<Kind extends EngineQueryKind>(
    query: EngineQueryInput<Kind>,
  ): Promise<EngineQueryResult<EngineQueryForKind<Kind>>>;
  async function query(query: EngineQuery): Promise<EngineQueryResult> {
    let parsed: EngineQuery;
    let bytes: Uint8Array;
    try {
      parsed = parseEngineQuery(query);
      bytes = encodeEngineQuery(parsed);
    } catch (error) {
      return { status: "rejected", error: invalidError(error) };
    }
    try {
      return decodeEngineQueryResult(await transport.query(bytes), parsed);
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
      let parsed: EngineCommand;
      let bytes: Uint8Array;
      try {
        parsed = parseEngineCommand(command);
        bytes = encodeEngineCommand(parsed);
      } catch (error) {
        return { status: "rejected", error: invalidError(error) };
      }
      try {
        return decodeWriteResult(await transport.execute(bytes));
      } catch {
        return { status: "outcome-unknown", invocationId: parsed.invocationId };
      }
    },
    query,
    subscribe(listener: (event: EngineEvent) => void) {
      return (
        transport.subscribe?.((bytes) => {
          try {
            listener(decodeEngineEvent(bytes));
          } catch {
            // A malformed event is isolated from the rest of the stream.
          }
        }) ?? (() => {})
      );
    },
  };
}

function invalidError(error: unknown) {
  return {
    code: "invalid-input" as const,
    message: error instanceof Error ? error.message : String(error),
    currentGenerationId: null,
  };
}
