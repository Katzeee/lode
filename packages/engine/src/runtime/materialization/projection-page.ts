import type { ProjectionPage, ProjectionPageSection } from "../../application/contract.js";
import type { ProjectionIdentity, ViewMode } from "../../domain/fact/index.js";

export function projectionPage<Section extends ProjectionPageSection>(
  identity: ProjectionIdentity,
  view: ViewMode,
  section: Section,
  next: string | null,
  entries: readonly Readonly<{ identity: string; value: unknown }>[],
): ProjectionPage<Section> {
  const value =
    section === "templateNodeInstances"
      ? entries.map((entry) => entry.value)
      : Object.fromEntries(entries.map((entry) => [entry.identity, entry.value]));
  return { identity, view, section, next, [section]: value } as ProjectionPage<Section>;
}
