export class AuthorityFaultError extends Error {}
export class AuthorityCommitUnknownError extends Error {
  constructor(
    readonly invocationId: string,
    options?: ErrorOptions,
  ) {
    super(`Authority commit outcome is unknown: ${invocationId}`, options);
  }
}
export class InvocationConflictError extends Error {}
export class ProjectionUnavailableError extends Error {}
