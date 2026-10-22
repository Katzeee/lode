import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  scrypt,
  sign,
} from "node:crypto";

import { describe, expect, it } from "vitest";

import { aeadOpen, aeadSeal, deriveContentKey } from "./aead.js";
import { sha256Bytes } from "./digest.js";
import { ed25519PublicFromSeed, exchangeSecret, signBytes, x25519PublicFromSecret } from "./keys.js";
import { deriveVaultKey } from "./kdf.js";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

describe("portable crypto formats", () => {
  it("matches Node for fixed Ed25519 and X25519 material", () => {
    const message = Buffer.from("lode-portable-crypto");
    const signingSeed = Buffer.alloc(32, 7);
    const nodeSigningPrivate = createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_PREFIX, signingSeed]),
      format: "der",
      type: "pkcs8",
    });
    const nodeSigningPublic = createPublicKey(nodeSigningPrivate).export({ type: "spki", format: "der" }).subarray(-32);

    expect(ed25519PublicFromSeed(signingSeed)).toEqual(new Uint8Array(nodeSigningPublic));
    expect(signBytes(message, signingSeed)).toEqual(new Uint8Array(sign(null, message, nodeSigningPrivate)));

    const aliceSecret = Buffer.alloc(32, 11);
    const bobSecret = Buffer.alloc(32, 19);
    const nodeAlicePrivate = x25519PrivateKey(aliceSecret);
    const nodeBobPrivate = x25519PrivateKey(bobSecret);
    const nodeBobPublic = createPublicKey(nodeBobPrivate);

    expect(x25519PublicFromSecret(bobSecret)).toEqual(
      new Uint8Array(nodeBobPublic.export({ type: "spki", format: "der" }).subarray(-32)),
    );
    expect(exchangeSecret(aliceSecret, x25519PublicFromSecret(bobSecret))).toEqual(
      new Uint8Array(
        diffieHellman({
          privateKey: nodeAlicePrivate,
          publicKey: nodeBobPublic,
        }),
      ),
    );
  });

  it("opens AES-256-GCM blobs in both implementations", () => {
    const message = Buffer.from("lode-portable-crypto");
    const key = Buffer.alloc(32, 23);
    const portableBlob = aeadSeal(key, message);
    const portableNonce = portableBlob.subarray(0, 12);
    const portableCiphertext = portableBlob.subarray(12, -16);
    const portableTag = portableBlob.subarray(-16);
    const nodeDecipher = createDecipheriv("aes-256-gcm", key, portableNonce);
    nodeDecipher.setAuthTag(portableTag);
    const nodeOpened = Buffer.concat([nodeDecipher.update(portableCiphertext), nodeDecipher.final()]);
    expect(nodeOpened).toEqual(message);

    const nodeNonce = Buffer.alloc(12, 29);
    const nodeCipher = createCipheriv("aes-256-gcm", key, nodeNonce);
    const nodeCiphertext = Buffer.concat([nodeCipher.update(message), nodeCipher.final()]);
    const nodeBlob = Buffer.concat([nodeNonce, nodeCiphertext, nodeCipher.getAuthTag()]);
    expect(aeadOpen(key, nodeBlob)).toEqual(new Uint8Array(message));
  });

  it("matches Node HKDF-SHA256, SHA-256, and scrypt bytes", async () => {
    const message = Buffer.from("lode-portable-crypto");
    const salt = Buffer.alloc(12, 29);
    const info = "lode-hkdf";

    expect(deriveContentKey(message, salt, info)).toEqual(
      new Uint8Array(hkdfSync("sha256", message, salt, Buffer.from(info), 32)),
    );
    expect(sha256Bytes(message)).toEqual(new Uint8Array(createHash("sha256").update(message).digest()));

    const parameters = { n: 16_384, r: 8, p: 1 };
    const portableKey = await deriveVaultKey("portable-passphrase", salt, parameters);
    const nodeKey = await nodeScrypt("portable-passphrase", salt, parameters);
    expect(portableKey).toEqual(new Uint8Array(nodeKey));
  });
});

function x25519PrivateKey(secret: Uint8Array) {
  return createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, secret]),
    format: "der",
    type: "pkcs8",
  });
}

function nodeScrypt(
  passphrase: string,
  salt: Uint8Array,
  parameters: Readonly<{ n: number; r: number; p: number }>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase,
      salt,
      32,
      {
        N: parameters.n,
        r: parameters.r,
        p: parameters.p,
        maxmem: 64 * 1024 * 1024,
      },
      (error, key) => {
        if (error === null) {
          resolve(key);
        } else {
          reject(error);
        }
      },
    );
  });
}
