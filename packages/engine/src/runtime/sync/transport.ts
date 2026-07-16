import type { WorkspaceDocSet } from "../../core/store/doc-set.js";
import type { SyncBytes } from "../../core/store/syncable.js";
import type { WireSecurity } from "../membership/wire-security.js";
import type { WorkspaceLock } from "../workspace/loro-lock.js";

export type SyncProfile = { subDocId: string; version: SyncBytes }[];

export type SyncTransport = {
  remoteProfile(): Promise<SyncProfile>;
  fetchUpdates(subDocId: string, from: SyncBytes): Promise<Uint8Array>;
  sendUpdates(subDocId: string, bytes: Uint8Array): Promise<void>;
  directedFetchUpdates(subDocId: string, from: SyncBytes, toPeerId: string): Promise<Uint8Array>;
  peers(): Promise<string[]>;
};

export type ManagedSyncTransport = SyncTransport & {
  open(): Promise<void>;
  close(): void | Promise<void>;
};

export type SyncTransportInput = {
  readonly url: string;
  readonly workspaceId: string;
  readonly documents: WorkspaceDocSet;
  readonly security: WireSecurity;
  readonly peerId: string;
  /** The workspace's loro read/write lock. The transport's RESPONDER half (answering a peer's
   *  request / applying a peer's push) touches LOCAL loro docs from the network message pump —
   *  outside SyncExchange — so it must acquire this lock at each loro stage (shared for reads,
   *  exclusive for imports) to stay off the client read/write boundaries. The initiator half is
   *  network-only and never touches local docs, so it does not acquire. */
  readonly lock: WorkspaceLock;
};

export type SyncTransportFactory = (input: SyncTransportInput) => ManagedSyncTransport;
