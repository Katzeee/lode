// One module graph gives every scenario the same browser lifecycle while Vitest still reports
// each behavioral guarantee independently.
import "./accessibility.acceptance.mjs";
import "./coarse-pointer.acceptance.mjs";
import "./navigation.acceptance.mjs";
import "./outline.acceptance.mjs";
import "./overlays.acceptance.mjs";
import "./responsive-patterns.acceptance.mjs";
import "./viewport.acceptance.mjs";
