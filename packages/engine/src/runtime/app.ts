// Lean composition root, mirroring anytype's app.Component / app.App but adapted to TS:
// constructor injection (the caller builds a component with its deps, then registers it)
// rather than Go's service-locator lookup. A Component is a named subsystem with optional
// async start/stop. The App starts components in registration order and stops them in
// reverse — centralizing lifecycle that would otherwise be hand-coded per subsystem.
//
// app.child() creates a sub-runtime whose `parent` is this App. Each loaded workspace is
// such a ChildApp (see workspace-registry.ts): its components stop independently on unload,
// and it is the mounting point for future per-workspace subsystems (sync state, indexer,
// query cache). Cross-level access (a per-workspace component reaching a daemon-global)
// is wired by passing the parent's already-constructed components into the child at build
// time — no runtime lookup needed.

export type Component = {
  readonly name: string;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
};

export class App {
  private readonly components: Component[] = [];
  private started = false;

  readonly parent?: App;

  constructor(parent?: App) {
    this.parent = parent;
  }

  // Constructor injection: register returns the same instance so the caller keeps a typed
  // reference; the App owns only its lifecycle ordering.
  register<T extends Component>(component: T): T {
    this.components.push(component);
    return component;
  }

  child(): App {
    return new App(this);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    for (const component of this.components) {
      await component.start?.();
    }
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    for (const component of [...this.components].reverse()) {
      await component.stop?.();
    }
    this.started = false;
  }
}
