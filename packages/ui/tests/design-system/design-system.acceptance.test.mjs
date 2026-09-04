// One module graph gives every scenario the same browser lifecycle while Vitest still reports
// each behavioral guarantee independently.
import "./accessibility.acceptance.mjs";
import "./coarse-pointer.acceptance.mjs";
import "./navigation.acceptance.mjs";
import "./outline.acceptance.mjs";
import "./outline-keyboard.acceptance.mjs";
import "./outline-focus.acceptance.mjs";
import "./outline-interaction.acceptance.mjs";
import "./outline-transactions.acceptance.mjs";
import "./outline-inline-editing.acceptance.mjs";
import "./outline-readonly.acceptance.mjs";
import "./outline-reference-data.acceptance.mjs";
import "./overlays.acceptance.mjs";
import "./suggestions.acceptance.mjs";
import "./responsive-patterns.acceptance.mjs";
import "./viewport.acceptance.mjs";
