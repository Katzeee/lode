import {
  parseFieldDefinitionConfigurationCreate,
  parseFieldDefinitionEndpointConfigure,
} from "./field-definition-configuration-input-validation.js";
import { inputObject } from "./input-validation-primitives.js";
import {
  parseSearchExpressionCreate,
  parseSearchExpressionUpdate,
  parseSharedDefaultViewDefinitionCreate,
  parseSharedDefaultViewDefinitionRemove,
  parseSharedDefaultViewDefinitionOptionsUpdate,
  parseSupertagApplicationCreate,
} from "./relation-input-validation.js";
import { parseStructuralEdit } from "./structural-input-validation.js";
import type { EditMutation } from "./types.js";
import {
  parseCodeNodeConfigure,
  parseDebugNodeOpen,
  parseFieldValueCreate,
  parseSharedDefaultViewDefinitionSortByNameCreate,
  parseUrlNodeCreate,
} from "./breadth-input-validation.js";
import {
  parseSupertagOptionalFieldContributionAdd,
  parseSupertagTemplateFieldAddExisting,
  parseSupertagTemplateFieldCreate,
  parseSupertagTemplateFieldMakeDiscoverable,
  parseSupertagTemplateFieldRemove,
  parseSupertagTemplateFieldStaticDefaultSet,
  parseSupertagTemplateFieldVisibilitySet,
} from "./template-field-input-validation.js";
import { parseTypedFieldValueEdit } from "./typed-field-value-input-validation.js";

export function parseEditMutation(value: unknown): EditMutation {
  const edit = inputObject(value);
  switch (edit.kind) {
    case "debug-node-open":
      return parseDebugNodeOpen(edit);
    case "field-value-create":
      return parseFieldValueCreate(edit);
    case "field-number-value-set":
    case "field-date-value-set":
    case "field-checkbox-value-set":
    case "field-options-from-supertag-value-set":
    case "typed-field-value-clear":
      return parseTypedFieldValueEdit(edit);
    case "url-node-create":
      return parseUrlNodeCreate(edit);
    case "code-node-configure":
      return parseCodeNodeConfigure(edit);
    case "shared-default-view-definition-sort-by-name-create":
      return parseSharedDefaultViewDefinitionSortByNameCreate(edit);
    case "supertag-application-create":
      return parseSupertagApplicationCreate(edit);
    case "supertag-template-field-create":
      return parseSupertagTemplateFieldCreate(edit);
    case "supertag-template-field-add-existing":
      return parseSupertagTemplateFieldAddExisting(edit);
    case "supertag-template-field-make-discoverable":
      return parseSupertagTemplateFieldMakeDiscoverable(edit);
    case "supertag-template-field-remove":
      return parseSupertagTemplateFieldRemove(edit);
    case "supertag-template-field-static-default-set":
      return parseSupertagTemplateFieldStaticDefaultSet(edit);
    case "supertag-template-field-visibility-set":
      return parseSupertagTemplateFieldVisibilitySet(edit);
    case "supertag-optional-field-contribution-add":
      return parseSupertagOptionalFieldContributionAdd(edit);
    case "search-expression-create":
      return parseSearchExpressionCreate(edit);
    case "search-expression-update":
      return parseSearchExpressionUpdate(edit);
    case "shared-default-view-definition-create":
      return parseSharedDefaultViewDefinitionCreate(edit);
    case "shared-default-view-definition-remove":
      return parseSharedDefaultViewDefinitionRemove(edit);
    case "shared-default-view-definition-options-update":
      return parseSharedDefaultViewDefinitionOptionsUpdate(edit);
    case "field-datatype-configuration-create":
    case "field-cardinality-configuration-create":
    case "field-optionality-configuration-create":
    case "field-initialization-expression-configuration-create":
      return parseFieldDefinitionConfigurationCreate(edit);
    case "field-datatype-configure":
    case "field-cardinality-configure":
    case "field-optionality-configure":
      return parseFieldDefinitionEndpointConfigure(edit);
    default:
      return parseStructuralEdit(edit);
  }
}
