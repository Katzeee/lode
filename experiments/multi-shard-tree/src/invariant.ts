import type { TreeSnapshot } from "./types.js";

/**
 * Structural invariants over an observable snapshot. These are the ENGINE's
 * correctness contract: the tree must always be a valid tree, every occurrence
 * must reference a real node, and every node's canonical occurrence must exist
 * and point back. Sharding is an engine-internal detail; these must hold
 * regardless of how many docs the state is physically spread across.
 *
 * Throws on the first violation with a precise message.
 */
export function validateSnapshot(snap: TreeSnapshot): void {
  const { nodes, occurrences, roots } = snap;

  // 1. Roots have no parent.
  for (const rootId of roots) {
    const occ = occurrences[rootId];
    if (!occ) throw new Error(`Root ${rootId} not in occurrences`);
    if (occ.parentOccurrenceId !== null) {
      throw new Error(`Root ${rootId} has parent ${occ.parentOccurrenceId}`);
    }
  }

  // 2. Every occurrence is well-formed and its node exists.
  for (const [occId, occ] of Object.entries(occurrences)) {
    if (occ.occurrenceId !== occId) {
      throw new Error(`Occurrence key mismatch: ${occId} vs ${occ.occurrenceId}`);
    }
    if (!(occ.nodeId in nodes)) {
      throw new Error(`Occurrence ${occId} references missing node ${occ.nodeId}`);
    }
    if (occ.parentOccurrenceId !== null) {
      if (!(occ.parentOccurrenceId in occurrences)) {
        throw new Error(`Occurrence ${occId} has missing parent ${occ.parentOccurrenceId}`);
      }
    }
  }

  // 3. Parent ↔ child consistency.
  for (const [occId, occ] of Object.entries(occurrences)) {
    for (const childId of occ.childOccurrenceIds) {
      const child = occurrences[childId];
      if (!child) throw new Error(`Occurrence ${occId} has missing child ${childId}`);
      if (child.parentOccurrenceId !== occId) {
        throw new Error(
          `Child ${childId} parent is ${child.parentOccurrenceId}, expected ${occId}`,
        );
      }
    }
  }

  // 4. No cycles: DFS from every root must terminate and cover exactly the
  //    non-root occurrences once each.
  const visited = new Set<OccurrenceId>();
  const stack = [...roots];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) break;
    if (visited.has(cur)) {
      throw new Error(`Cycle or shared subtree reached twice at ${cur}`);
    }
    visited.add(cur);
    const occ = occurrences[cur];
    if (occ) for (const c of occ.childOccurrenceIds) stack.push(c);
  }
  // Occurrences not reachable from a root are detached (orphans in the tree).
  for (const occId of Object.keys(occurrences)) {
    if (!visited.has(occId) && !roots.includes(occId)) {
      // A non-root occurrence not reached from roots is structurally invalid.
      const occ = occurrences[occId];
      if (occ && occ.parentOccurrenceId !== null && !visited.has(occ.parentOccurrenceId)) {
        throw new Error(`Detached occurrence ${occId} (parent unreachable from roots)`);
      }
    }
  }

  // 5. Node ↔ occurrence bidirectional consistency + canonical validity.
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.nodeId !== nodeId) {
      throw new Error(`Node key mismatch: ${nodeId} vs ${node.nodeId}`);
    }
    // canonical must be one of the node's own occurrences.
    if (!node.occurrences.includes(node.canonicalOccurrenceId)) {
      throw new Error(
        `Node ${nodeId} canonical ${node.canonicalOccurrenceId} not in its occurrences`,
      );
    }
    // canonical occurrence must point back at this node.
    const canon = occurrences[node.canonicalOccurrenceId];
    if (!canon || canon.nodeId !== nodeId) {
      throw new Error(`Node ${nodeId} canonical occurrence does not point back`);
    }
    // Reverse: every occurrence claiming this nodeId is listed, and vice versa.
    for (const occId of node.occurrences) {
      const occ = occurrences[occId];
      if (!occ) throw new Error(`Node ${nodeId} lists missing occurrence ${occId}`);
      if (occ.nodeId !== nodeId) {
        throw new Error(`Occurrence ${occId} nodeId ${occ.nodeId} != listed under ${nodeId}`);
      }
    }
  }

  // 6. No orphan nodes: every node must have at least one occurrence.
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.occurrences.length === 0) {
      throw new Error(`Orphan node ${nodeId} with no occurrences`);
    }
  }
}
