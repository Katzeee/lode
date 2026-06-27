/**
 * Fresh deterministic nodeId generator ("n0", "n1", …). Paired with the TruthModel
 * (whose nodeIdx advances only on createNode) so `nodeIdx === Number(nodeId.slice(1))`
 * — the alignment the correctness fuzz uses to project an engine snapshot into the
 * model's idx space.
 */
export function counterGen(): () => string {
  let n = 0;
  return () => `n${n++}`;
}
