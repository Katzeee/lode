import { describe, expect, it } from "vitest";

import { CURRENT_PROJECTION_VERSIONS } from "../../../domain/reconcile/index.js";
import { Facts } from "../../../../tests/support/reconcile/reconcile-test-helpers.js";
import { WorkspaceProjection } from "./index.js";

describe("Workspace Projection state", () => {
  it("rebuilds from Facts and atomically advances generation, Review, and runtime indexes", () => {
    const facts = new Facts();
    const initial = facts.snapshot();
    const events: string[] = [];
    const projection = WorkspaceProjection.open("workspace", initial, CURRENT_PROJECTION_VERSIONS, (event) =>
      events.push(event.kind),
    );

    facts.addPlaced("node");
    projection.advance(facts.snapshot());

    const current = projection.current;
    expect(current.generation.origin.nodes.node).toMatchObject({ nodeId: "node" });
    expect(current.generation.review.identity).toEqual(current.generation.identity);
    expect(current.indexes.origin.sectionIdentities.nodes).toContain("node");
    expect(current.generation.identity.frontier).toEqual(current.snapshot.frontier);
    expect(events).toEqual(["projection-published"]);
  });

  it("keeps the last complete state after a failed advance and reports recovery", () => {
    const facts = new Facts();
    const initial = facts.snapshot();
    const events: string[] = [];
    const projection = WorkspaceProjection.open("workspace", initial, CURRENT_PROJECTION_VERSIONS, (event) =>
      events.push(event.kind),
    );
    facts.addPlaced("first");
    projection.advance(facts.snapshot());
    const published = projection.current;

    expect(() => projection.advance(initial)).toThrow("Next Fact snapshot does not contain the previous frontier");
    expect(projection.current).toBe(published);
    expect(projection.failure).not.toBeNull();

    facts.addPlaced("second");
    projection.advance(facts.snapshot());
    expect(projection.current.generation.origin.nodes).toHaveProperty("second");
    expect(projection.failure).toBeNull();
    expect(events).toEqual(["projection-published", "projection-failed", "projection-recovered"]);
  });
});
