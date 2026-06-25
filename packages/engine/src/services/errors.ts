// Engine-internal typed errors. These carry no wire/error-code knowledge — the daemon
// (Connect layer) maps them to Connect status codes + details. In-process callers (mobile)
// handle them directly. This keeps the engine free of the transport/RPC contract.

export class SessionRequiredError extends Error {
  constructor(message = "Session handshake required") {
    super(message);
    this.name = "SessionRequiredError";
  }
}

export class DocNotFoundError extends Error {
  readonly docId: string;

  constructor(docId: string) {
    super(`Doc not found: ${docId}`);
    this.name = "DocNotFoundError";
    this.docId = docId;
  }
}
