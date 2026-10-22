import type { GraphAction } from "../fact/index.js";
import type { InterpretedProjection } from "../reconcile/index.js";

export class AuthoredIntentViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthoredIntentViolation";
  }
}

export type AuthoredIntentContext = Readonly<{
  previous: InterpretedProjection;
  available: InterpretedProjection;
  resulting: InterpretedProjection;
}>;

type ActionOf<Kind extends GraphAction["kind"]> = Extract<GraphAction, { kind: Kind }>;

export type AuthoredIntentFamily<Kind extends GraphAction["kind"] = GraphAction["kind"]> = Readonly<{
  key: string;
  actionKinds: readonly Kind[];
  assert(action: ActionOf<Kind>, context: AuthoredIntentContext): void;
}>;
