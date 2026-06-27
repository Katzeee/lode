// Public entry. Re-exports the runtime composition root + the cross-layer types the
// daemon and in-process clients need. See runtime/app-runtime.ts for the composition.

export type { PersistenceOptions } from "./runtime/workspace-registry.js";
export type { AppContext } from "./services/index.js";
export type { EngineOrigin } from "./session/session-manager.js";
export { SessionRequiredError } from "./session/session-manager.js";
export { DocNotFoundError } from "./services/errors.js";
export { DomainInvalidInputError } from "./domain/errors.js";

export type { AppRuntime, AppRuntimeOptions, LodeCommands } from "./runtime/app-runtime.js";
export { createAppRuntime } from "./runtime/app-runtime.js";
