import { randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import {
  ActorSchema,
  SessionInfoSchema,
  type Actor,
  type ClientInfo,
  type Notification,
  type SessionHelloRequest,
  type SessionInfo,
} from "@lode/protocol/proto";
import type { ActorKeypair } from "../../crypto/index.js";
import type { RuntimeInstance } from "../kernel/runtime.js";
import type { MountedComponent, RuntimeResource } from "../kernel/resource.js";
import type { ResolvedCaller } from "../identity/caller.js";
import { BoundedAsyncChannel } from "../../events/bounded-async-channel.js";
import type { Bus, Subscription } from "../../events/bus.js";
import { Committed } from "../workspace/workspace-facts.js";
import { projectNotification } from "./notification-projector.js";

const DEFAULT_NOTIFICATION_CAPACITY = 256;

export class SessionRequiredError extends Error {
  constructor(message = "Session handshake required") {
    super(message);
    this.name = "SessionRequiredError";
  }
}

type SessionRecord = {
  readonly sessionId: string;
  readonly actor: Actor | undefined;
  readonly keypair: ActorKeypair | undefined;
  readonly connectedAt: bigint;
  readonly client: ClientInfo | undefined;
};

type ClientConnection = {
  session?: SessionRecord;
  readonly notifications: BoundedAsyncChannel<Notification>;
  readonly subscriptions: Map<string, Subscription[]>;
};

/** One owner for a connection's authenticated identity, subscriptions, and notification stream. */
export class ClientSessionManager implements RuntimeResource {
  readonly id = "client-sessions";
  private readonly connections = new Map<string, MountedComponent<ClientConnection>>();
  private readonly mounting = new Map<string, Promise<MountedComponent<ClientConnection>>>();

  constructor(
    private readonly instance: RuntimeInstance,
    private readonly originLabel: string,
    private readonly notificationCapacity = DEFAULT_NOTIFICATION_CAPACITY,
  ) {}

  async createSession(
    connectionId: string,
    request: SessionHelloRequest,
    keypair?: ActorKeypair,
  ): Promise<SessionInfo> {
    const actor =
      keypair === undefined ? undefined : create(ActorSchema, { actorId: keypair.actorId });
    const session: SessionRecord = {
      sessionId: randomUUID(),
      actor,
      keypair,
      connectedAt: BigInt(Date.now()),
      client: request.client,
    };
    (await this.connection(connectionId)).session = session;
    return create(SessionInfoSchema, {
      sessionId: session.sessionId,
      actor: session.actor,
      connectedAt: session.connectedAt,
      ...(session.client === undefined ? {} : { client: session.client }),
    });
  }

  resolveCaller(connectionId: string): ResolvedCaller {
    const record = this.connections.get(connectionId)?.api.session;
    if (record?.actor === undefined || record.keypair === undefined) {
      throw new SessionRequiredError();
    }
    return {
      origin: {
        nodeId: this.originLabel,
        actorId: record.actor.actorId,
        sessionId: record.sessionId,
      },
      keypair: record.keypair,
    };
  }

  async subscribeWorkspace(
    connectionId: string,
    workspaceId: string,
    instance: RuntimeInstance,
    facts: Bus,
  ): Promise<void> {
    this.resolveCaller(connectionId);
    const connection = await this.connection(connectionId);
    this.unsubscribeWorkspace(connectionId, workspaceId);
    const subs: Subscription[] = [];
    const committed = facts.on(Committed, (fact) => this.deliver(connection, fact));
    if (committed !== null) {
      subs.push(committed);
    }
    subs.push({
      unsubscribe: instance.onStopped(() => {
        if (connection.subscriptions.get(workspaceId) === subs) {
          connection.subscriptions.delete(workspaceId);
        }
        subs.forEach((subscription) => subscription.unsubscribe());
      }),
    });
    if (subs.length > 0) {
      connection.subscriptions.set(workspaceId, subs);
    }
  }

  unsubscribeWorkspace(connectionId: string, workspaceId: string): void {
    const subscriptions = this.connections.get(connectionId)?.api.subscriptions;
    subscriptions?.get(workspaceId)?.forEach((s) => s.unsubscribe());
    subscriptions?.delete(workspaceId);
  }

  listenNotifications(connectionId: string): AsyncIterable<Notification> {
    return this.notificationStream(this.connection(connectionId));
  }

  async removeConnection(connectionId: string): Promise<void> {
    const mounted = this.connections.get(connectionId) ?? (await this.mounting.get(connectionId));
    if (mounted === undefined) {
      return;
    }
    await mounted.instance.stop({ checkpoint: false });
  }

  release(): void {
    this.connections.clear();
    this.mounting.clear();
  }

  private async connection(connectionId: string): Promise<ClientConnection> {
    const existing = this.connections.get(connectionId);
    if (existing !== undefined) {
      return existing.api;
    }
    let pending = this.mounting.get(connectionId);
    if (pending === undefined) {
      pending = this.instance.mount(`connection:${connectionId}`, (instance) => {
        const connection: ClientConnection = {
          notifications: new BoundedAsyncChannel(this.notificationCapacity),
          subscriptions: new Map(),
        };
        instance.own({
          id: "connection-state",
          release: () => this.closeConnection(connection),
        });
        return connection;
      });
      this.mounting.set(connectionId, pending);
    }
    try {
      const mounted = await pending;
      this.connections.set(connectionId, mounted);
      mounted.instance.onStopped(() => {
        if (this.connections.get(connectionId) === mounted) {
          this.connections.delete(connectionId);
        }
      });
      return mounted.api;
    } finally {
      this.mounting.delete(connectionId);
    }
  }

  private async *notificationStream(
    pendingConnection: Promise<ClientConnection>,
  ): AsyncIterable<Notification> {
    const connection = await pendingConnection;
    yield* connection.notifications;
  }

  private deliver(
    connection: ClientConnection,
    event: Parameters<typeof projectNotification>[0],
  ): void {
    const notification = projectNotification(event);
    if (notification === null) {
      return;
    }
    if (!connection.notifications.push(notification)) {
      this.closeSubscriptions(connection);
    }
  }

  private closeConnection(connection: ClientConnection): void {
    this.closeSubscriptions(connection);
    connection.notifications.close();
    connection.session = undefined;
  }

  private closeSubscriptions(connection: ClientConnection): void {
    for (const subs of connection.subscriptions.values()) {
      subs.forEach((s) => s.unsubscribe());
    }
    connection.subscriptions.clear();
  }
}
