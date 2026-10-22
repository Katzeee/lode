import { describe, expect, it } from "vitest";

import { datatypeConfiguration, requiredEndpoint } from "./field-edit-actions.js";

describe("Field edit action construction", () => {
  it("uses the built-in Fact schema identities for datatype and required state", () => {
    expect(datatypeConfiguration("field", "options-from-supertag", "options-tag")).toEqual({
      kind: "field-datatype-configure",
      fieldDefinitionId: "field",
      datatypeNodeId: "system-field-datatype:v1:options-from-supertag",
      optionsSupertagId: "options-tag",
    });
    expect(requiredEndpoint(true)).toBe("system-field-optionality:v1:yes");
    expect(requiredEndpoint(false)).toBe("system-field-optionality:v1:no");
  });
});
