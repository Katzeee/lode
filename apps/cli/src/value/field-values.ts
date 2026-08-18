import { CliError } from "../outcome/index.js";

/**
 * Typed Field value parsing. The field's configured Datatype decides how a
 * raw argv/file value is interpreted; validation failures happen here, before
 * any write. Field scalar parsing is shared with the Search expression
 * language.
 */

export const FIELD_DATATYPES = ["plain", "options", "options-from-supertag", "number", "checkbox", "date"] as const;

export type FieldDatatype = (typeof FIELD_DATATYPES)[number];

export type ParsedFieldValue =
  | Readonly<{ kind: "plain"; text: string }>
  | Readonly<{ kind: "number"; value: number }>
  | Readonly<{ kind: "checkbox"; value: boolean }>
  | Readonly<{ kind: "date"; value: string }>
  | Readonly<{ kind: "options-from-supertag"; targetToken: string }>;

export function parseFieldValue(datatype: FieldDatatype, raw: string): ParsedFieldValue {
  switch (datatype) {
    case "plain":
      return { kind: "plain", text: raw };
    case "number": {
      if (!/^[+-]?\d+(\.\d+)?$/u.test(raw)) {
        throw new CliError("invalid-value", `“${raw}” is not a finite decimal number.`);
      }
      return { kind: "number", value: Number(raw) };
    }
    case "checkbox": {
      if (raw !== "true" && raw !== "false") {
        throw new CliError("invalid-value", `Checkbox values are true or false, not “${raw}”.`);
      }
      return { kind: "checkbox", value: raw === "true" };
    }
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(raw) || !isValidDate(raw)) {
        throw new CliError("invalid-value", `“${raw}” is not an ISO YYYY-MM-DD date.`);
      }
      return { kind: "date", value: raw };
    }
    case "options":
    case "options-from-supertag":
      return { kind: "options-from-supertag", targetToken: raw };
  }
}

function isValidDate(raw: string): boolean {
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw;
}

/** Maps a configured datatype endpoint node id back to its datatype name. */
export function datatypeOfEndpoint(endpointNodeId: string | null | undefined): FieldDatatype | null {
  if (endpointNodeId === null || endpointNodeId === undefined) {
    return null;
  }
  const prefix = "system-field-datatype:v1:";
  return endpointNodeId.startsWith(prefix) ? (endpointNodeId.slice(prefix.length) as FieldDatatype) : null;
}

export function datatypeEndpoint(datatype: FieldDatatype): string {
  return `system-field-datatype:v1:${datatype}`;
}
