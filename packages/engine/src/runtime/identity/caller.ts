// Cross-cutting identity types shared across layers (services, runtime, event). Lives at
// the src root so every layer can import it without a new DAG edge — it is pure data, no behavior.
import type { ActorKeypair } from "../../crypto/index.js";

/** The origin stamped on every emitted change / notification: which replica + actor + session
 *  produced it. `nodeId` is the engine's origin label (the per-dataRoot peer id); `actorId` is the
 *  acting session's Ed25519 actor id; `sessionId` identifies the connection's session. */
export type EngineOrigin = {
  nodeId: string;
  actorId: string;
  sessionId: string;
};

/** The resolved caller for an authenticated RPC — produced at the dispatch boundary from the
 *  connectionId (never undefined: `authed` handlers receive it non-null; `open` handlers take none).
 *  `origin` is the change/notification attribution; `keypair` is the acting actor's Ed25519 keypair
 *  (for signing — workspace root, membership ops). */
export type ResolvedCaller = {
  readonly origin: EngineOrigin;
  readonly keypair: ActorKeypair;
};
