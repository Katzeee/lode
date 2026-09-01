import { buildImportGraph, collectPackageImports } from "./import-graph.mjs";
import { verifyRepositoryArchitecture } from "./checks.mjs";
import { readRepository } from "./repository.mjs";

export async function analyzeRepositoryArchitecture(repositoryRoot) {
  const repository = await readRepository(repositoryRoot);
  const [importGraph, packageImports] = await Promise.all([
    buildImportGraph(repository),
    collectPackageImports(repository.allSourceFiles),
  ]);
  const diagnostics = [
    ...importGraph.diagnostics,
    ...(await verifyRepositoryArchitecture(repository, importGraph.graph, packageImports)),
  ];
  return { diagnostics, repository };
}
