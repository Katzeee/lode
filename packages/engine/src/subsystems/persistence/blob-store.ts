export type BlobStore = Readonly<{
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
}>;
