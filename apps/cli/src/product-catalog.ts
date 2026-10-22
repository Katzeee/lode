import { CommandCatalog } from "./catalog/index.js";
import { registerFieldCommands } from "./families/field.js";
import { registerHistoryCommands } from "./families/history.js";
import { registerIdentityCommands } from "./families/identity.js";
import { registerNodeCommands } from "./families/node.js";
import { registerReferenceCommands } from "./families/reference.js";
import { registerReviewCommands } from "./families/review.js";
import { registerSearchCommands } from "./families/search.js";
import { registerSupertagCommands } from "./families/supertag.js";
import { registerSyncCommands } from "./families/sync.js";
import { registerViewCommands } from "./families/view.js";
import { registerWorkspaceGovernanceCommands } from "./families/workspace-governance.js";
import { registerWorkspaceCommands } from "./families/workspace.js";
import { daemonCommands } from "./manage/daemon.js";
import { homeCommands } from "./manage/home.js";

export function createProductCatalog(): CommandCatalog {
  const catalog = new CommandCatalog();
  for (const register of [
    registerWorkspaceCommands,
    registerWorkspaceGovernanceCommands,
    registerIdentityCommands,
    registerNodeCommands,
    registerReferenceCommands,
    registerSupertagCommands,
    registerFieldCommands,
    registerSearchCommands,
    registerViewCommands,
    registerHistoryCommands,
    registerReviewCommands,
    registerSyncCommands,
  ]) {
    register(catalog);
  }
  for (const definition of [...homeCommands(), ...daemonCommands()]) {
    catalog.register(definition);
  }
  return catalog;
}
