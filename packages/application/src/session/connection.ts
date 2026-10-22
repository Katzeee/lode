import type { EngineApplicationContract } from "@lode/sdk";
import { parseEngineCommand, parseEngineQuery } from "@lode/sdk/host";
import type {
  ApplicationConnection,
  ApplicationHost,
  ApplicationState,
  InitializeInput,
  InitializeResult,
} from "./contract.js";

export async function dispatchApplicationRequest(
  host: ApplicationHost,
  method: string,
  input: unknown,
): Promise<unknown> {
  switch (method) {
    case "state":
      return host.getState();
    case "initialize":
      return host.initialize(parseInitializeInput(input));
    case "unlock":
      return host.unlock(passphrase(input));
    case "create-workspace":
      return host.createWorkspace(label(input, "Workspace name"));
    case "execute":
      return host.engine.execute(parseEngineCommand(input));
    case "query":
      return host.engine.query(parseEngineQuery(input));
    default:
      throw new Error(`Unknown application operation: ${method}`);
  }
}

export function connectApplication(connection: ApplicationConnection): ApplicationHost {
  // Replies originate in dispatchApplicationRequest; only this transport boundary restores their types.
  const request = <Value>(method: string, input?: unknown) => connection.request(method, input) as Promise<Value>;
  const engine: EngineApplicationContract = {
    execute: async (command) => {
      try {
        return await request("execute", command);
      } catch {
        return { status: "outcome-unknown", invocationId: command.invocationId };
      }
    },
    query: (query) => request("query", query),
    subscribe: (listener, onError) =>
      connection.subscribe((message) => {
        if (message.kind === "engine") {
          listener(message.event);
        }
        if (message.kind === "error") {
          onError(new Error(message.message));
        }
      }),
  };
  return {
    engine,
    getState: () => request<ApplicationState>("state"),
    initialize: (input) => request<InitializeResult>("initialize", input),
    unlock: (input) => request<ApplicationState>("unlock", input),
    createWorkspace: (input) => request<ApplicationState>("create-workspace", input),
    onStateChanged: (listener) =>
      connection.subscribe((message) => {
        if (message.kind === "state") {
          listener(message.state);
        }
      }),
  };
}

function parseInitializeInput(value: unknown): InitializeInput {
  if (typeof value !== "object" || value === null || !("actorLabel" in value) || !("passphrase" in value)) {
    throw new Error("Invalid initialization request");
  }
  return { actorLabel: label(value.actorLabel, "Name"), passphrase: passphrase(value.passphrase) };
}

function passphrase(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 512) {
    throw new Error("Passphrase must contain between 8 and 512 characters");
  }
  return value;
}

function label(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 120) {
    throw new Error(`${name} must contain between 1 and 120 characters`);
  }
  return value.trim();
}
