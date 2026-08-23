import { parseFieldDefinitionConfigure } from "./field-definition-configuration-input-validation.js";
import { inputObject } from "./input-validation-primitives.js";
import {
  parseSearchExpressionCreate,
  parseSearchExpressionEdit,
  parseViewEdit,
  parseSupertagApplicationCreate,
  parseSupertagApplicationRemove,
} from "./relation-input-validation.js";
import { parseStructuralEdit } from "./structural-input-validation.js";
import type { EditAction } from "./types.js";
import { parseCodeNodeConfigure, parseFieldValueCreate, parseUrlNodeCreate } from "./breadth-input-validation.js";
import {
  parseSupertagOptionalFieldContributionAdd,
  parseSupertagOptionalFieldContributionRemove,
  parseSupertagTemplateFieldAddExisting,
  parseSupertagTemplateFieldCreate,
  parseSupertagTemplateFieldMakeDiscoverable,
  parseSupertagTemplateFieldRemove,
  parseSupertagTemplateFieldStaticDefaultSet,
  parseSupertagTemplateFieldVisibilitySet,
} from "./template-field-input-validation.js";
import { parseTypedFieldValueEdit } from "./typed-field-value-input-validation.js";

export function parseEditAction(value: unknown): EditAction {
  const edit = inputObject(value);
  switch (edit.kind) {
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
    case "supertag-application-create":
      return parseSupertagApplicationCreate(edit);
    case "supertag-remove":
      return parseSupertagApplicationRemove(edit);
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
    case "supertag-optional-field-contribution-remove":
      return parseSupertagOptionalFieldContributionRemove(edit);
    case "search-expression-create":
      return parseSearchExpressionCreate(edit);
    case "search-expression-add":
    case "search-expression-configure":
    case "search-expression-move":
    case "search-expression-remove":
      return parseSearchExpressionEdit(edit);
    case "shared-default-view-create":
    case "shared-default-view-remove":
    case "view-mode-set":
    case "view-column-add":
    case "view-column-remove":
    case "view-column-move":
    case "view-sort-add":
    case "view-sort-configure":
    case "view-sort-remove":
    case "view-sort-by-node-name":
    case "view-group-add":
    case "view-group-remove":
    case "view-filter-create":
    case "view-filter-remove":
    case "view-filter-expression-add":
    case "view-filter-expression-configure":
    case "view-filter-expression-move":
    case "view-filter-expression-remove":
      return parseViewEdit(edit);
    case "field-datatype-configure":
    case "field-cardinality-configure":
    case "field-optionality-configure":
    case "field-initialization-expression-configure":
      return parseFieldDefinitionConfigure(edit);
    default:
      return parseStructuralEdit(edit);
  }
}
