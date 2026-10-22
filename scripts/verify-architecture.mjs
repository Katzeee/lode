import { resolve } from "node:path";
import { analyzeRepositoryArchitecture } from "./architecture/index.mjs";

const { diagnostics, repository } = await analyzeRepositoryArchitecture(resolve(import.meta.dirname, ".."));

if (diagnostics.length > 0) {
  console.error("Architecture verification failed:");
  for (const diagnostic of diagnostics) {
    console.error(`\n${diagnostic.category}:`);
    for (const detail of diagnostic.details) {
      console.error(`  ${detail}`);
    }
  }
  process.exitCode = 1;
} else {
  console.log(
    `Verified ${repository.productionFiles.length} production source files (${repository.handwrittenProductionFiles.length} handwritten): runtime imports are acyclic, directory-module dependencies are one-way, all sources are reachable, architecture paths are live, and package dependencies have production consumers.`,
  );
}
