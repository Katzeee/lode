type FieldSourcePath = Readonly<{
  applicationNodeId: string;
  appliedSupertagId: string;
  sourceSupertagId: string;
  extensionPath: readonly string[];
}>;

export type EffectiveTemplateFieldSource = FieldSourcePath &
  Readonly<{
    kind: "template";
    templateFieldNodeId: string;
    staticDefaultValueNodeId: string;
    visibility: "normal" | "pinned";
  }>;

export type EffectiveOptionalFieldSource = FieldSourcePath &
  Readonly<{
    kind: "optional";
    optionalContributionNodeId: string;
  }>;

export type EffectiveFieldSource = EffectiveTemplateFieldSource | EffectiveOptionalFieldSource;

export type StaticDefaultCandidate = Readonly<{
  value: string;
  sourceTemplateFieldNodeIds: readonly string[];
}>;

export type EffectiveStaticDefault =
  | Readonly<{ state: "none"; candidates: readonly [] }>
  | Readonly<{
      state: "value";
      value: string;
      sourceTemplateFieldNodeId: string;
      candidates: readonly StaticDefaultCandidate[];
    }>
  | Readonly<{ state: "conflict"; candidates: readonly StaticDefaultCandidate[] }>;

export type EffectiveField = Readonly<{
  ownerNodeId: string;
  fieldDefinitionId: string;
  sources: readonly EffectiveFieldSource[];
  staticDefault: EffectiveStaticDefault;
  visibility: "normal" | "pinned";
  visibilityConflicted: boolean;
  materializedFieldNodeId: string | null;
}>;

export type OptionalFieldSuggestion = Readonly<{
  ownerNodeId: string;
  fieldDefinitionId: string;
  sources: readonly EffectiveOptionalFieldSource[];
}>;
