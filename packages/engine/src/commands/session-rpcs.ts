import { create } from "@bufbuild/protobuf";
import type { Empty } from "@bufbuild/protobuf/wkt";
import {
  CreateIdentityResponseSchema,
  ImportIdentityResponseSchema,
  VaultIdentitySchema,
  VaultState,
  VaultStatusSchema,
  type ActorMnemonic,
  type ActorPublicKeys,
  type CreateIdentityRequest,
  type CreateIdentityResponse,
  type ImportIdentityRequest,
  type ImportIdentityResponse,
  type InitVaultRequest,
  type ListenNotificationsRequest,
  type Notification,
  type SessionHelloRequest,
  type SessionInfo,
  type SetPinRequest,
  type SubscribeDocRequest,
  type UnsubscribeDocRequest,
  type UnlockVaultRequest,
  type UnlockWithPinRequest,
  type VaultStatus,
} from "@lode/protocol/proto";
import { ActorMnemonicSchema, ActorPublicKeysSchema } from "@lode/protocol/proto";
import { authed, open } from "./handler.js";
import { EMPTY } from "./wire/empty.js";
import type { WorkspaceRegistry } from "../runtime/workspace/registry.js";
import type { ClientSessionManager } from "../runtime/session/client-session-manager.js";
import type { VaultRuntime, VaultStatusInfo } from "../runtime/identity/vault.js";
import { deriveActorKeypair, mintActorIdentity } from "../runtime/identity/identity-policy.js";

// The RPCs that are NOT domain adapters — session/identity (hello, mint, getActorPublicKeys) +
// notification (subscribe/unsubscribe/listen) + the vault (init/unlock/lock/create/import/list/status).
// They reach the identity store + the notification manager + the vault directly (runtime-resident), so
// they live alongside the domain handlers in commands/ and take the concrete subsystems as parameters.
// Each handler declares its own auth contract: hello/mint/listen/vault are `open` (no session — hello
// CREATES it, mint is bootstrap, listen is the pre-auth stream, vault is identity bootstrap/unlock);
// getActorPublicKeys/subscribe/unsubscribe are `authed`.

export function createSessionRpcs(
  sessions: ClientSessionManager,
  workspaces: WorkspaceRegistry,
  vault: VaultRuntime,
) {
  return {
    // The client sends only the mnemonic; the identity policy derives the keypair. A bad/undecodable
    // mnemonic → AuthenticationError; the session is never created. Open (it CREATES the session).
    sessionHello: open(
      async (req: SessionHelloRequest, connectionId: string): Promise<SessionInfo> => {
        const keypair = deriveActorKeypair(req.mnemonic);
        return sessions.createSession(connectionId, req, keypair);
      },
    ),

    // Mint a fresh actor identity — a 12-word mnemonic + the actor id it derives to. Open by design:
    // the bootstrap (`lode actor new`) a new user calls once, before any authed command is possible.
    generateActorMnemonic: open((_req: Empty): ActorMnemonic => {
      const { mnemonic, actorId } = mintActorIdentity();
      return create(ActorMnemonicSchema, { mnemonic, actorId });
    }),

    // ── vault (open; identity bootstrap + unlock-on-demand) ────────────────────────────────────
    initVault: open(async (req: InitVaultRequest): Promise<VaultStatus> =>
      toVaultStatus(await vault.init(req.passphrase)),
    ),
    createIdentity: open(async (req: CreateIdentityRequest): Promise<CreateIdentityResponse> => {
      const { actorId, mnemonic } = await vault.createIdentity(req.label);
      return create(CreateIdentityResponseSchema, { actorId, mnemonic });
    }),
    importIdentity: open(async (req: ImportIdentityRequest): Promise<ImportIdentityResponse> => {
      const { actorId } = await vault.importIdentity(req.mnemonic, req.label);
      return create(ImportIdentityResponseSchema, { actorId });
    }),
    listIdentities: open((): VaultStatus => toVaultStatus(vault.status())),
    unlockVault: open(async (req: UnlockVaultRequest): Promise<VaultStatus> =>
      toVaultStatus(await vault.unlock(req.passphrase)),
    ),
    lockVault: open((): VaultStatus => toVaultStatus(vault.lock())),
    setPin: open(async (req: SetPinRequest): Promise<VaultStatus> =>
      toVaultStatus(await vault.setPin(req.pin)),
    ),
    unlockWithPin: open(async (req: UnlockWithPinRequest): Promise<VaultStatus> =>
      toVaultStatus(await vault.unlockWithPin(req.pin)),
    ),
    getVaultStatus: open((): VaultStatus => toVaultStatus(vault.status())),

    // The caller's public identity — what a peer needs to add this actor as a sync member. Authed;
    // the sign pub comes from the caller's keypair.
    getActorPublicKeys: authed((_req: Empty, caller): ActorPublicKeys =>
      create(ActorPublicKeysSchema, {
        actorId: caller.origin.actorId,
        signPub: caller.keypair.publicKey,
      }),
    ),

    subscribeDoc: authed(async (req: SubscribeDocRequest, _caller, connectionId: string) => {
      await workspaces.runWorkspace(req.workspaceId, ({ instance, facts }) => {
        return sessions.subscribeWorkspace(connectionId, req.workspaceId, instance, facts);
      });
      return EMPTY;
    }),

    unsubscribeDoc: authed((req: UnsubscribeDocRequest, _caller, connectionId: string) => {
      sessions.unsubscribeWorkspace(connectionId, req.workspaceId);
      return EMPTY;
    }),

    // The per-connection notification stream; the host (Connect) streams it to the client. Open it
    // before subscribing to receive notifications.
    listenNotifications: open(
      (_req: ListenNotificationsRequest, connectionId: string): AsyncIterable<Notification> =>
        sessions.listenNotifications(connectionId),
    ),
  };
}

function toVaultStatus(info: VaultStatusInfo): VaultStatus {
  return create(VaultStatusSchema, {
    state:
      info.state === "UNLOCKED"
        ? VaultState.VAULT_UNLOCKED
        : info.state === "GRACE"
          ? VaultState.VAULT_GRACE
          : VaultState.VAULT_LOCKED,
    identities: info.identities.map((id) =>
      create(VaultIdentitySchema, {
        actorId: id.actorId,
        label: id.label,
        createdAt: BigInt(id.createdAt),
      }),
    ),
    hasPin: info.hasPin,
    activeUntil: BigInt(info.activeUntil),
    pinFailedCount: info.pinFailedCount,
  });
}

/** The session/notification/identity/vault RPCs — merged with the domain commands before auth-wrapping. */
export type SessionRpcs = ReturnType<typeof createSessionRpcs>;
