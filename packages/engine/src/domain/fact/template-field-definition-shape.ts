import { exact, object, ShapeValidationError } from "../../decoding/index.js";
import { field } from "./action-definition.js";
import { nonemptyStringField } from "./action-field-decoders.js";
import { parseNodeSeed } from "./node-create-shape.js";
import type { NodeSeed } from "./node-create-types.js";

type TemplateFieldDefinition =
  | Readonly<{ kind: "new"; fieldDefinitionId: string; seed?: NodeSeed }>
  | Readonly<{ kind: "existing"; fieldDefinitionId: string }>;

export const templateFieldDefinitionField = field<TemplateFieldDefinition>((value) => {
  const definition = object(value, "Template Field Definition");
  if (definition.kind === "existing") {
    exact(definition, ["kind", "fieldDefinitionId"], "existing Template Field Definition");
    const fieldDefinitionId = nonemptyStringField.parse(definition.fieldDefinitionId, "Field Definition identity");
    return { kind: "existing", fieldDefinitionId };
  }
  if (definition.kind === "new") {
    const keys = definition.seed === undefined ? ["kind", "fieldDefinitionId"] : ["kind", "fieldDefinitionId", "seed"];
    exact(definition, keys, "new Template Field Definition");
    const fieldDefinitionId = nonemptyStringField.parse(definition.fieldDefinitionId, "Field Definition identity");
    const seed = definition.seed === undefined ? undefined : parseNodeSeed(definition.seed);
    return seed === undefined ? { kind: "new", fieldDefinitionId } : { kind: "new", fieldDefinitionId, seed };
  }
  throw new ShapeValidationError(`Unknown Template Field Definition kind: ${String(definition.kind)}`);
});
