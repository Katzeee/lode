export function childSequenceIdentity(parentNodeId: string): string {
  return `parent:node:${encodeURIComponent(parentNodeId)}`;
}

export function childSequenceParent(identity: string): string {
  const prefix = "parent:node:";
  if (!identity.startsWith(prefix)) {
    throw new Error(`Invalid ChildSequence Diff Space identity: ${identity}`);
  }
  return decodeURIComponent(identity.slice(prefix.length));
}
