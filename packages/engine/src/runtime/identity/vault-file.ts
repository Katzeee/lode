import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { KdfParams } from "../../crypto/index.js";
import { PreconditionFailedError } from "../../errors/index.js";
import { DomainInvalidInputError } from "../../domain/errors.js";

// vault.json persistence + serialization + the TTL policy (de)serialization — the on-disk/config shape
// and crash-safe write/read, split out of vault.ts so the state machine file stays under the line cap.
// Pure (crypto types + errors + fs).

/** Unlock-lease TTL policy (stored in config.json; `lode config unlock-ttl`). */
export type VaultTtl =
  { kind: "always" } | { kind: "duration"; ms: number; sliding: boolean } | { kind: "session" };

/** Default: 8h sliding — re-confirm only after 8h idle, refreshed on each use. */
export const DEFAULT_TTL: VaultTtl = { kind: "duration", ms: 8 * 60 * 60 * 1000, sliding: true };

/** Parse a TTL policy spec (`always` | `duration:<ms>` | `session`). A 0 (or negative) duration is
 *  rejected — it would expire on the very next access and brick every domain command. */
export function parseUnlockTtl(spec: string): VaultTtl {
  if (spec === "always") {
    return { kind: "always" };
  }
  if (spec === "session") {
    return { kind: "session" };
  }
  if (spec.startsWith("duration:")) {
    const ms = Number(spec.slice("duration:".length));
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new DomainInvalidInputError(`invalid duration: ${spec}`);
    }
    return { kind: "duration", ms, sliding: true };
  }
  throw new DomainInvalidInputError(
    `invalid unlock-ttl (expected always | duration:<ms> | session): ${spec}`,
  );
}

export const VAULT_VERSION = 1;
// Sealed under the derived key at init, opened first at unlock — proves the passphrase is right even
// when the vault has no identities yet.
export const VAULT_CANARY = "lode-vault-v1";

export type VaultEntry = { actorId: string; label: string; createdAt: number; ct: string };
export type VaultPin = { verifier: string; salt: string };
export type VaultFile = {
  version: number;
  kdf: { algo: "scrypt"; salt: string; params: KdfParams; verifier: string };
  pin?: VaultPin;
  entries: VaultEntry[];
};

export async function readVaultFile(path: string): Promise<VaultFile | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new PreconditionFailedError("vault.json is unreadable", { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PreconditionFailedError("vault.json is corrupt (invalid JSON)", { cause: error });
  }
  if (!isVaultFile(parsed)) {
    throw new PreconditionFailedError("vault.json is corrupt (unexpected shape)");
  }
  return parsed;
}

function isVaultFile(value: unknown): value is VaultFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  const kdf = v.kdf as Record<string, unknown> | undefined;
  return (
    v.version === VAULT_VERSION &&
    kdf?.algo === "scrypt" &&
    typeof kdf?.salt === "string" &&
    typeof kdf?.verifier === "string" &&
    Array.isArray(v.entries)
  );
}

export function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Reject a secret shorter than `minLen` (passphrase floor, PIN floor). */
export function requireStrength(secret: string, minLen: number): void {
  if (secret.length < minLen) {
    throw new DomainInvalidInputError(`must be at least ${minLen} characters`);
  }
}

export function fromB64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// Crash-safe write (temp + fsync + rename) so a partial write never corrupts the vault. A daemon-owned
// file (single writer), so the Windows rename-over-existing fallback (unlink then rename) is safe here.
export async function atomicWrite(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${dirname(path)}/.${basename(path)}.${randomUUID()}.tmp`;
  const handle = await open(tmp, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch {
    await unlink(path).catch(() => {});
    await rename(tmp, path);
  }
}
