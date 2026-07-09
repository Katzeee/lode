// Pure byte-util leaf — no engine imports. Allocation-free equality for `Uint8Array` (versions,
// frontiers, keys) where the stdlib `Buffer.equals` would allocate two Buffers per compare on a hot
// path (the incremental-sync cursor + the membership-log dirty check both compare every round).

/** Byte-by-byte equality (with the reference-shortcut fast path). Not constant-time — these bytes
 *  are public version/frontier data, not secrets. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) {
    return true;
  }
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
