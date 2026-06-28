import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import * as net from "node:net";
import type { Socket } from "node:net";
import { type Cipher, FrameSocket } from "./wire.js";
import { exchangeDocSetSide, type DocSet } from "./multi-sync.js";

/**
 * P5 transport: payload-level AES-256-GCM AEAD over an instrumented pairwise bridge. Validates the
 * §5 transit-privacy property: clients encrypt sync content end-to-end (`node:crypto` AEAD) and a
 * forwarding transport routes opaque ciphertext — it cannot read workspace content. The cipher
 * (`makeAesGcmCipher`) + the `Cipher` slot on `FrameSocket` ARE the production transit-encryption
 * mechanism — no WireGuard (that was tunwg-bundled; tunwg is only an optional reachability choice,
 * design §3a, not built).
 *
 * `makeRelayedPair` is a PAIRWISE instrumented bridge (exactly 2 clients), used only to run the
 * transit-privacy oracle. It is NOT the production relay: the production relay is the §3
 * workspace-routing BROKER (multi-client, subscription, route-by-workspace), validated separately
 * (P6). This bridge is a P5 transport shape, not a relay model.
 *
 * Fidelity note: the cipher encrypts the frame PAYLOAD only; the bridge still sees plaintext tag +
 * length bytes (message counts/kinds). The playground asserts "transport cannot read CONTENT," not
 * "transport sees only opaque bytes."
 */

/** AES-256-GCM AEAD. Each `enc` emits a fresh random IV (12B) + ciphertext + auth tag (16B); `dec`
 *  reverses. Authenticated — a tampered/truncated blob throws at `final()`. */
export function makeAesGcmCipher(key: Buffer): Cipher {
  return {
    enc(plain: Uint8Array): Uint8Array {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(plain), c.final()]);
      const tag = c.getAuthTag();
      return Buffer.concat([iv, ct, tag]);
    },
    dec(blob: Uint8Array): Uint8Array {
      if (blob.length < 12 + 16) {
        throw new Error("cipher blob too short");
      }
      const iv = Buffer.from(blob.subarray(0, 12));
      const tag = Buffer.from(blob.subarray(blob.length - 16));
      const ct = Buffer.from(blob.subarray(12, blob.length - 16));
      const d = createDecipheriv("aes-256-gcm", key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]);
    },
  };
}

export type RelayedPair = {
  readonly a: Socket;
  readonly b: Socket;
  /** Every byte chunk the relay forwarded (ciphertext payloads + plaintext frame headers). */
  relayBytes: () => Buffer;
  close: () => void;
};

/** A pairwise instrumented bridge: exactly two clients connect; each one's bytes are piped to the
 *  other and every forwarded chunk is logged. This is a P5 transport shape for the transit-privacy
 *  oracle, NOT the §3 workspace-routing broker (that's P6). Holds no LoroDoc, runs no sync code.
 *  The connection handler is registered AFTER `cA`/`cB` are created (in the `listen` callback), so
 *  it closes over assigned sockets — no cross-callback race on resolve. */
export function makeRelayedPair(): Promise<RelayedPair> {
  return new Promise((resolve, reject) => {
    const log: Buffer[] = [];
    const peers: Socket[] = [];
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      const cA = net.connect(port, "127.0.0.1");
      const cB = net.connect(port, "127.0.0.1");
      // Register after cA/cB exist so the handler closes over assigned sockets.
      server.on("connection", (s) => {
        peers.push(s);
        s.on("data", (chunk: Buffer) => {
          log.push(chunk);
          for (const other of peers) {
            if (other !== s && !other.destroyed) {
              other.write(chunk);
            }
          }
        });
        if (peers.length === 2) {
          resolve({
            a: cA,
            b: cB,
            relayBytes: () => Buffer.concat(log),
            close: () => {
              cA.destroy();
              cB.destroy();
              server.close();
            },
          });
        }
      });
    });
  });
}

/** Doc-set exchange over the instrumented relay, with an optional E2E cipher. Returns the relay's
 *  forwarded-byte log so the transit-privacy oracle can inspect what the relay saw. */
export async function exchangeOverRelay(
  a: DocSet,
  b: DocSet,
  cipher?: Cipher,
): Promise<{ relayBytes: () => Buffer }> {
  const { a: sockA, b: sockB, relayBytes, close } = await makeRelayedPair();
  const fa = new FrameSocket(sockA, cipher);
  const fb = new FrameSocket(sockB, cipher);
  try {
    await Promise.all([exchangeDocSetSide(a, fa), exchangeDocSetSide(b, fb)]);
  } finally {
    close();
  }
  return { relayBytes };
}
