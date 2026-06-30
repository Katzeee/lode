// Engine's crypto leaf — Ed25519 signing, X25519 dual-use ECDH, AES-256-GCM AEAD, BIP-39/SLIP-10
// mnemonic recovery. A pure leaf (node:crypto + @noble/curves + @scure/bip39); no engine internals,
// no persistence, no protocol.

export { aeadEncrypt, aeadDecrypt } from "./aes.js";
export { generateMnemonic, validateMnemonic, mnemonicToSeed } from "./bip39.js";
export { deriveEd25519Node, deriveEd25519Seed, type Slip10Node } from "./slip10.js";
export { edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from "./curve.js";
export {
  actorIdFromPublicKey,
  generateActorKeypair,
  keypairFromEd25519Seed,
  ed25519SeedFromPrivateKey,
  deriveActorKeypairFromMnemonic,
  signWithActor,
  verifyActorSignature,
  serializeActorPrivateKey,
  deserializeActorPrivateKey,
  type ActorKeypair,
  type ActorPrivateKey,
  type ActorPublicKey,
} from "./actor-key.js";
export {
  actorEncryptionPublic,
  actorEncryptionPrivate,
  wrapKey,
  unwrapKey,
} from "./actor-encryption.js";
