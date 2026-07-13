import type { WorkspaceDocSet } from "../../core/store/doc-set.js";
import type { SyncBytes } from "../../core/store/syncable.js";
import type { WireSecurity } from "../membership/wire-security.js";

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
};

export type SyncTransportFactory = (input: SyncTransportInput) => ManagedSyncTransport;
