import type { ProjectedNode } from "@lode/sdk";

import { CliError } from "../outcome/index.js";

export const TARGET_KINDS = [
  "workspace",
  "node",
  "occurrence",
  "reference",
  "supertag",
  "field",
  "search",
  "view",
  "review",
  "conflict",
] as const;

export type TargetKind = (typeof TARGET_KINDS)[number];

/** Node-backed target kinds and the intrinsic node types they match. */
export const NODE_KIND_INTRINSICS: Readonly<
  Record<"node" | "supertag" | "field" | "search", readonly (string | null)[]>
> = {
  node: [null],
  supertag: ["supertag-definition"],
  field: ["field-definition"],
  search: ["search"],
};

const LINK_PREFIX = "lode://workspace/";

export type ParsedSelector =
  | Readonly<{ form: "link"; workspaceId: string; kind: TargetKind; identity: string }>
  | Readonly<{ form: "ref"; kind: TargetKind; identity: string }>
  | Readonly<{ form: "label"; label: string }>;

export function parseSelector(token: string): ParsedSelector {
  if (token.startsWith(LINK_PREFIX)) {
    const segments = token.slice(LINK_PREFIX.length).split("/");
    const [encodedWorkspace, kind, encodedIdentity] = segments;
    if (segments.length !== 3 || !encodedWorkspace || !kind || encodedIdentity === undefined) {
      throw new CliError("usage", `Malformed canonical link: ${token}`);
    }
    if (!TARGET_KINDS.includes(kind as TargetKind)) {
      throw new CliError("usage", `Canonical link has unknown kind: ${kind}`);
    }
    return {
      form: "link",
      workspaceId: decodeURIComponent(encodedWorkspace),
      kind: kind as TargetKind,
      identity: decodeURIComponent(encodedIdentity),
    };
  }
  const separator = token.indexOf(":");
  if (separator > 0) {
    const kind = token.slice(0, separator);
    if (!TARGET_KINDS.includes(kind as TargetKind)) {
      // A colon does not make a typed ref unless the prefix is a known kind.
      return { form: "label", label: token.normalize("NFC") };
    }
    const identity = token.slice(separator + 1);
    if (identity.length === 0) {
      throw new CliError("usage", `Typed ref has no identity: ${token}`);
    }
    return { form: "ref", kind: kind as TargetKind, identity };
  }
  return { form: "label", label: token.normalize("NFC") };
}

export type ResourceDescriptor = Readonly<{
  kind: TargetKind;
  id: string;
  ref: string;
  link: string;
  label: string;
}>;

export function descriptor(workspaceId: string, kind: TargetKind, id: string, label: string): ResourceDescriptor {
  return {
    kind,
    id,
    ref: `${kind}:${id}`,
    link: `${LINK_PREFIX}${encodeURIComponent(workspaceId)}/${kind}/${encodeURIComponent(id)}`,
    label,
  };
}

export function nodeLabel(node: ProjectedNode): string {
  return node.content.flatMap((item) => (item.kind === "text" ? [item.value] : [])).join("");
}

export type WorkspaceEntry = Readonly<{ workspaceId: string; label: string }>;

/**
 * Resolves a workspace selector (canonical link, workspace: ref, or exact
 * label) against the host's known workspaces. Shared by explicit Workspace
 * resolution and the workspace family.
 */
export function resolveWorkspaceFromList(known: readonly WorkspaceEntry[], token: string): WorkspaceEntry {
  const selector = parseSelector(token);
  const byId = known.find((entry) => entry.workspaceId === (selector.form === "label" ? token : selector.identity));
  if (byId !== undefined) {
    return byId;
  }
  if (selector.form === "label") {
    const matches = known.filter((entry) => entry.label.normalize("NFC") === selector.label);
    if (matches.length === 0) {
      throw new CliError(
        "target-not-found",
        `No workspace is named exactly “${selector.label}”. Known workspaces: ${
          known.map((entry) => entry.label || entry.workspaceId).join(", ") || "(none)"
        }.`,
      );
    }
    if (matches.length > 1) {
      throw new CliError(
        "ambiguous-target",
        `Workspace name “${selector.label}” matches ${matches.length} workspaces. Pass the workspace: ref.`,
        {
          candidates: matches.map((entry) => ({
            ref: `workspace:${entry.workspaceId}`,
            link: `lode://workspace/${encodeURIComponent(entry.workspaceId)}/workspace/${encodeURIComponent(entry.workspaceId)}`,
            label: entry.label,
            parents: [],
          })),
        },
      );
    }
    return matches.at(0) ?? { workspaceId: selector.label, label: selector.label };
  }
  if (selector.kind !== "workspace") {
    throw new CliError("usage", `A workspace selector must be a workspace target, not ${selector.kind}.`);
  }
  const match = known.find((entry) => entry.workspaceId === selector.identity);
  if (match === undefined) {
    throw new CliError("target-not-found", `Workspace ${selector.identity} does not exist on this daemon.`);
  }
  return match;
}
