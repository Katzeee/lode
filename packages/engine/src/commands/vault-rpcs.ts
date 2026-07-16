import { create } from "@bufbuild/protobuf";
import {
  CreateIdentityResponseSchema,
  ImportIdentityResponseSchema,
  VaultIdentitySchema,
  VaultState,
  VaultStatusSchema,
  type CreateIdentityRequest,
  type CreateIdentityResponse,
  type ImportIdentityRequest,
  type ImportIdentityResponse,
  type InitVaultRequest,
  type SetPinRequest,
  type UnlockVaultRequest,
  type UnlockWithPinRequest,
  type VaultStatus,
} from "@lode/protocol/proto";
import { open } from "./handler.js";
import type { VaultRuntime, VaultStatusInfo } from "../runtime/identity/vault.js";

// The vault RPCs — identity bootstrap + unlock-on-demand (init/create/import/list/unlock/lock/setPin/
// unlockWithPin/status). They reach the identity vault directly (runtime-resident), so they live in
// commands/ alongside the domain handlers and take the concrete VaultRuntime. All `open`: the vault is
// identity bootstrap/unlock, which happens BEFORE any authed command is possible — the socket is the
// permission boundary, and the unlocked vault then gates the authed domain commands by loading the
// caller's keypair. Session/notification/identity RPCs live in session-rpcs.ts.

export function createVaultRpcs(vault: VaultRuntime) {
  return {
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

/** The vault RPCs — merged with the domain commands + session RPCs before auth-wrapping. */
export type VaultRpcs = ReturnType<typeof createVaultRpcs>;
