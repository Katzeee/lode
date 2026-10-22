import type {
  EngineCommand as ProtocolEngineCommand,
  EngineEvent as ProtocolEngineEvent,
  EngineQuery as ProtocolEngineQuery,
  QueryResult as ProtocolQueryResult,
  WriteResult as ProtocolWriteResult,
} from "@lode/protocol/proto";
import type {
  EngineCommand,
  EngineApplicationContract,
  EngineEvent,
  EngineQuery,
  EngineQueryForKind,
  EngineQueryInput,
  EngineQueryKind,
  EngineQueryResult,
  EventFailureListener,
  Unsubscribe,
} from "./contract.js";
import {
  engineCommandToMessage,
  engineEventFromMessage,
  engineQueryToMessage,
  queryResultFromMessage,
  writeResultFromMessage,
} from "./protocol-codec.js";
import { parseEngineCommand, parseEngineQuery } from "./validation.js";
import { ProtocolInputEncodingError, ProtocolInputValidationError } from "./protocol-input-error.js";

export type EngineTransport = Readonly<{
  execute(command: ProtocolEngineCommand): Promise<EngineTransportExecution>;
  query(query: ProtocolEngineQuery): Promise<ProtocolQueryResult>;
  subscribe(listener: (event: ProtocolEngineEvent) => void, onError: EventFailureListener): Unsubscribe;
}>;

export type EngineTransportExecution =
  Readonly<{ status: "response"; message: ProtocolWriteResult }> | Readonly<{ status: "outcome-unknown" }>;

export function createTransportEngineApplication(transport: EngineTransport): EngineApplicationContract {
  async function query<Kind extends EngineQueryKind>(
    query: EngineQueryInput<Kind>,
  ): Promise<EngineQueryResult<EngineQueryForKind<Kind>>>;
  async function query(query: EngineQuery): Promise<EngineQueryResult> {
    let parsed: EngineQuery;
    try {
      parsed = parseEngineQuery(query);
    } catch (error) {
      if (error instanceof ProtocolInputValidationError) {
        return { status: "rejected", error: invalidError(error) };
      }
      throw error;
    }
    let message: ProtocolEngineQuery;
    try {
      message = engineQueryToMessage(parsed);
    } catch (error) {
      if (error instanceof ProtocolInputEncodingError) {
        return { status: "rejected", error: invalidError(error) };
      }
      throw error;
    }
    return queryResultFromMessage(await transport.query(message), parsed);
  }

  return {
    async execute(command) {
      let parsed: EngineCommand;
      try {
        parsed = parseEngineCommand(command);
      } catch (error) {
        if (error instanceof ProtocolInputValidationError) {
          return { status: "rejected", error: invalidError(error) };
        }
        throw error;
      }
      let message: ProtocolEngineCommand;
      try {
        message = engineCommandToMessage(parsed);
      } catch (error) {
        if (error instanceof ProtocolInputEncodingError) {
          return { status: "rejected", error: invalidError(error) };
        }
        throw error;
      }
      const execution = await transport.execute(message);
      if (execution.status === "outcome-unknown") {
        return { status: "outcome-unknown", invocationId: parsed.invocationId };
      }
      return writeResultFromMessage(execution.message);
    },
    query,
    subscribe(listener: (event: EngineEvent) => void, onError: EventFailureListener) {
      return transport.subscribe((message) => {
        let event: EngineEvent;
        try {
          event = engineEventFromMessage(message);
        } catch (error) {
          onError(error);
          return;
        }
        try {
          listener(event);
        } catch {
          // One consumer cannot break delivery to the transport's other listeners.
        }
      }, onError);
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
