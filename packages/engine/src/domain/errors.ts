export type DomainErrorDetails = Record<string, unknown>;

export class DomainInvalidInputError extends Error {
  readonly details: DomainErrorDetails | undefined;

  constructor(message: string, details?: DomainErrorDetails) {
    super(message);
    this.name = "DomainInvalidInputError";
    this.details = details;
  }
}

export function invalidDomainInput(message: string, details?: DomainErrorDetails): never {
  throw new DomainInvalidInputError(message, details);
}
