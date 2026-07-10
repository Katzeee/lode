import { create } from "@bufbuild/protobuf";
import { EmptySchema, type Empty } from "@bufbuild/protobuf/wkt";

// Shared empty response for void RPCs. Empty is immutable; reuse one instance.
export const EMPTY: Empty = create(EmptySchema);
