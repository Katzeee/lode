// Engine's crypto leaf — Ed25519 actor signing, X25519 peer keys, AES-256-GCM AEAD, transit-key
// wrapping, BIP-39/SLIP-10 mnemonic recovery. A pure leaf (node:crypto + @noble/curves + @scure/bip39);
// no engine internals, no persistence, no protocol.

export { aeadEncrypt, aeadDecrypt } from "./aes.js";
export { deriveVaultKey, DEFAULT_KDF_PARAMS, type KdfParams } from "./kdf.js";
export { generateMnemonic, validateMnemonic, mnemonicToSeed } from "./bip39.js";
export { deriveEd25519Node, deriveEd25519Seed, type Slip10Node } from "./slip10.js";
export {
  actorIdFromPublicKey,
  actorPublicKeyFromId,
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
export { wrapKey, unwrapKey } from "./transit-wrap.js";
export { generatePeerKeypair, peerKeypairFromPrivateKey, type PeerKeypair } from "./peer-key.js";
