import {
  ProjectionPerspective as ProtocolProjectionPerspective,
  ProjectionSection as ProtocolProjectionSection,
  TemplateFieldDefinitionOwner as ProtocolTemplateFieldDefinitionOwner,
  TemplateNodeState as ProtocolTemplateNodeState,
  TypedFieldValueState as ProtocolTypedFieldValueState,
} from "@lode/protocol/proto";
import { protocolEnum, protocolEnumCamel, type DomainEnum } from "./enum-codec.js";

export const projectionPerspective = protocolEnum(ProtocolProjectionPerspective, "Projection perspective");
export type ProjectionPerspective = DomainEnum<typeof projectionPerspective>;

// Projection sections are addressed by their camelCase property names, not kebab-case.
export const projectionSection = protocolEnumCamel(ProtocolProjectionSection, "Projection section");
export type ProjectionSection = DomainEnum<typeof projectionSection>;

export const typedFieldValueState = protocolEnum(ProtocolTypedFieldValueState, "Typed Field Value state");

export const templateNodeState = protocolEnum(ProtocolTemplateNodeState, "Template Node state");
export type TemplateNodeState = DomainEnum<typeof templateNodeState>;

export const templateFieldDefinitionOwner = protocolEnum(
  ProtocolTemplateFieldDefinitionOwner,
  "Template Field Definition Owner",
);
export type TemplateFieldDefinitionOwner = DomainEnum<typeof templateFieldDefinitionOwner>;
