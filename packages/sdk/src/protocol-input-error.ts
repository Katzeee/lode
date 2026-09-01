export class ProtocolInputEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolInputEncodingError";
  }
}

export class ProtocolInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolInputValidationError";
  }
}
