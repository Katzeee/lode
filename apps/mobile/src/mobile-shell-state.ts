import type { EngineHostState } from './engine-host-protocol';

export const startingState: EngineHostState = {
  phase: 'starting',
  vaultExists: false,
  actors: [],
  workspaces: [],
};

export type MobileSurface = 'design-system' | 'legal' | 'product';
