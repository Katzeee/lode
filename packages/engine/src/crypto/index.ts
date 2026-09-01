export { AeadAuthenticationError, aeadOpen, aeadSeal } from "./aead.js";
export {
  generateSigningKeyPair,
  generateExchangeKeyPair,
  signBytes,
  verifyBytes,
  ed25519PublicFromSeed,
  x25519PublicFromSecret,
  type SigningKeyPair,
  type ExchangeKeyPair,
} from "./keys.js";
export { openWithSecret, sealToPublicKey } from "./kx.js";
export { actorIdFromPublicKey, isActorId, isPeerId, peerIdFromPublicKey, peerPublicKeyFromId } from "./identity-ids.js";
export {
  DEFAULT_VAULT_KDF_PARAMETERS,
  MIN_PASSPHRASE_LENGTH,
  VAULT_CANARY,
  deriveVaultKey,
  generateVaultSalt,
  type VaultKdfParameters,
} from "./kdf.js";
export { generateRecoveryPhrase, keyPairFromPhrase, normalizePhrase } from "./mnemonic.js";
