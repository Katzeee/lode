import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  deriveActorKeypairFromMnemonic,
  deserializeActorPrivateKey,
  generateActorKeypair,
  serializeActorPrivateKey,
  type ActorKeypair,
  type ActorPrivateKey,
  type ActorPublicKey,
} from "../utils/crypto/index.js";
import { actorDbPath, actorKeystorePath } from "../persistence/paths.js";
import { bytesToBuffer, rowBytes, type SqlDatabase } from "../persistence/sql-database.js";
import { openSqliteDatabase } from "../persistence/better-sqlite-adapter.js";

/**
 * Per-dataRoot actor identity store (design sync-identity-persistence §3/§8). Two parts:
 *   - `actors.sqlite` catalog: actorId → displayName + raw Ed25519 public key.
 *   - `actors/<actorId>/keystore`: the PKCS8 private key, file mode 0600 (separate from the
 *     catalog for a clean secret boundary; at-rest passphrase encryption is a later feature).
 * Everything is per-dataRoot: copy the directory, get a complete identity set. Mnemonic recovery
 * (BIP-39/SLIP-10): createActor with a mnemonic re-derives the same key on any dataRoot
 * (continuity); the dual-use X25519 conversion lives in actor-encryption.ts.
 */
export type ActorRecord = {
  actorId: string;
  displayName: string;
  publicKey: ActorPublicKey;
  createdAt: number;
};

export class ActorStore {
  private constructor(
    private readonly db: SqlDatabase,
    private readonly dataRoot: string,
  ) {}

  static async open(dataRoot: string): Promise<ActorStore> {
    const db = await openSqliteDatabase(actorDbPath(dataRoot));
    await db.exec(`
      CREATE TABLE IF NOT EXISTS actors (
        actor_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        public_key BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    return new ActorStore(db, dataRoot);
  }

  /** Generate (random) or recover (from a mnemonic) an actor keypair, persist its private key to a
   *  0600 keystore, and record the public key in the catalog. Keystore is written BEFORE the catalog
   *  row so a failed insert leaves only a harmless orphan file (never a catalog row with no keystore).
   *  Recovering with a mnemonic whose actor already exists on this dataRoot is refused up front for a
   *  clear error (recover on a fresh dataRoot, or load the existing one) — the catalog's PRIMARY KEY
   *  would also reject the duplicate, but only with a generic constraint error. */
  async createActor(input: {
    displayName: string;
    mnemonic?: string;
  }): Promise<{ record: ActorRecord; keypair: ActorKeypair }> {
    const keypair = input.mnemonic
      ? deriveActorKeypairFromMnemonic(input.mnemonic)
      : generateActorKeypair();
    const now = Date.now();
    const record: ActorRecord = {
      actorId: keypair.actorId,
      displayName: input.displayName,
      publicKey: keypair.publicKey,
      createdAt: now,
    };
    if (input.mnemonic && (await this.getActor(record.actorId))) {
      throw new Error(`actor ${record.actorId} already exists on this dataRoot`);
    }
    await this.writeKeystore(record.actorId, serializeActorPrivateKey(keypair.privateKey));
    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO actors (actor_id, display_name, public_key, created_at) VALUES (?, ?, ?, ?)`,
        record.actorId,
        record.displayName,
        bytesToBuffer(record.publicKey),
        record.createdAt,
      );
    });
    return { record, keypair };
  }

  async listActors(): Promise<ActorRecord[]> {
    const rows = await this.db.all<ActorRow>(
      `SELECT actor_id, display_name, public_key, created_at FROM actors ORDER BY created_at ASC`,
    );
    return rows.map(rowToRecord);
  }

  async getActor(actorId: string): Promise<ActorRecord | null> {
    const row = await this.db.get<ActorRow>(
      `SELECT actor_id, display_name, public_key, created_at FROM actors WHERE actor_id = ?`,
      actorId,
    );
    return row ? rowToRecord(row) : null;
  }

  /** Load (and deserialize) an actor's private key from its keystore file. */
  async loadPrivateKey(actorId: string): Promise<ActorPrivateKey> {
    const bytes = await readFile(actorKeystorePath(this.dataRoot, actorId));
    return deserializeActorPrivateKey(new Uint8Array(bytes));
  }

  async removeActor(actorId: string): Promise<boolean> {
    let removed = false;
    await this.db.transaction(async () => {
      const result = await this.db.run("DELETE FROM actors WHERE actor_id = ?", actorId);
      removed = (result.changes ?? 0) > 0;
    });
    if (!removed) {
      return false;
    }
    // A removed catalog row must not leave a private key on disk: delete the keystore dir, then
    // verify the keystore file is actually gone. rm with force swallows ENOENT; we surface a real
    // deletion failure instead of silently leaving a key with no catalog pointer.
    await rm(dirname(actorKeystorePath(this.dataRoot, actorId)), { recursive: true, force: true });
    if (await pathExists(actorKeystorePath(this.dataRoot, actorId))) {
      throw new Error(`actor keystore still present after remove: ${actorId}`);
    }
    return true;
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  private async writeKeystore(actorId: string, bytes: Uint8Array): Promise<void> {
    const path = actorKeystorePath(this.dataRoot, actorId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytesToBuffer(bytes), { mode: 0o600 });
  }
}

type ActorRow = {
  actor_id: string;
  display_name: string;
  public_key: Buffer;
  created_at: number;
};

function rowToRecord(row: ActorRow): ActorRecord {
  return {
    actorId: row.actor_id,
    displayName: row.display_name,
    publicKey: rowBytes(row.public_key),
    createdAt: row.created_at,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
