export type BlobStore = Readonly<{
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
}>;

export class InMemoryBlobStore implements BlobStore {
  private bytes: Uint8Array | null = null;

  read(): Promise<Uint8Array | null> {
    return Promise.resolve(this.bytes === null ? null : Uint8Array.from(this.bytes));
  }

  write(bytes: Uint8Array): Promise<void> {
    this.bytes = Uint8Array.from(bytes);
    return Promise.resolve();
  }
}
