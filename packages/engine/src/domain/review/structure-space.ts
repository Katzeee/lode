export function childSequenceIdentity(parentOccurrenceId: string | null): string {
  return parentOccurrenceId === null
    ? "parent:root"
    : `parent:occurrence:${encodeURIComponent(parentOccurrenceId)}`;
}

export function childSequenceParent(identity: string): string | null {
  if (identity === "parent:root") {
    return null;
  }
  const prefix = "parent:occurrence:";
  if (!identity.startsWith(prefix)) {
    throw new Error(`Invalid ChildSequence Diff Space identity: ${identity}`);
  }
  return decodeURIComponent(identity.slice(prefix.length));
}
