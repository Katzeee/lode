import { createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { LodeCommands, type Notification, type SessionInfo } from "@lode/protocol/proto";

export type LodeCommandsClient = Client<typeof LodeCommands>;
export type NotificationHandler = (notification: Notification) => void;

export type AppServerClientOptions = {
  url: string;
};

export type AuthenticateOptions = {
  /** The actor's BIP-39 mnemonic; the daemon derives the keypair and verifies identity server-side. */
  readonly actorMnemonic: string;
  /** The claimed actor id — must match what the mnemonic derives to (the daemon checks). */
  readonly actorId: string;
  /** Optional human-readable name surfaced to the daemon (audit/debug display only). */
  readonly displayName?: string;
  /** Client identity hints surfaced to the daemon (UI surface name + version). */
  readonly client?: { readonly name?: string; readonly version?: string };
};

// Connect (gRPC over loopback TCP) client. `rpc` is the typed LodeCommands client every
// frontend uses; connect()/onNotification() drive the server-streaming notification pump.
export class AppServerClient {
  private readonly sessionManager: Http2SessionManager;
  readonly rpc: LodeCommandsClient;
  private notificationIter: AsyncIterator<Notification> | undefined;
  private readonly handlers = new Set<NotificationHandler>();

  constructor(options: AppServerClientOptions) {
    this.sessionManager = new Http2SessionManager(options.url);
    const transport = createGrpcTransport({
      baseUrl: options.url,
      sessionManager: this.sessionManager,
    });
    this.rpc = createClient(LodeCommands, transport);
  }

  // Opens the server-streaming notification channel. Call before onNotification handlers
  // are expected to fire (notifications are dropped server-side until this is open).
  connect(): void {
    this.notificationIter = this.rpc.listenNotifications({})[Symbol.asyncIterator]();
    void this.pumpNotifications();
  }

  /** Submit the mnemonic in `sessionHello`; the daemon derives the keypair and confirms the derived
   *  actor id matches the declared one before creating the session. The caller supplies only the
   *  mnemonic + actor id — no private key material crosses into the client. */
  async authenticate(opts: AuthenticateOptions): Promise<SessionInfo> {
    return this.rpc.sessionHello({
      actor: {
        actorId: opts.actorId,
        ...(opts.displayName === undefined ? {} : { displayName: opts.displayName }),
      },
      mnemonic: opts.actorMnemonic,
      ...(opts.client === undefined ? {} : { client: opts.client }),
    });
  }

  private async pumpNotifications(): Promise<void> {
    const iter = this.notificationIter;
    if (iter === undefined) {
      return;
    }
    try {
      while (true) {
        const result = await iter.next();
        if (result.done) {
          break;
        }
        for (const handler of this.handlers) {
          handler(result.value);
        }
      }
    } catch {
      // stream closed or errored — stop pumping
    }
  }

  onNotification(handler: NotificationHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    void this.notificationIter?.return?.();
    this.sessionManager.abort();
  }
}
