import { LegalPage, Spinner, ToastProvider, TooltipProvider } from '@lode/ui';
import { lazy, Suspense, useEffect, useState } from 'react';

import { createMobileEngineClient } from './engine-worker-client.js';
import type { EngineHostState } from './engine-worker/protocol.js';
import { ProductShell } from './product-shell.js';

type MobileSurface = 'design-system' | 'legal' | 'product';

// The catalog is a review surface most sessions never open; it stays out of
// the product's startup bundle and loads on demand.
const DesignSystemPage = lazy(async () => {
  const { DesignSystemPage: page } = await import('@lode/ui/catalog');
  return { default: page };
});

const startingState: EngineHostState = {
  phase: 'starting',
  vaultExists: false,
  actors: [],
  workspaces: [],
};

function currentSurface(): MobileSurface {
  if (window.location.hash.startsWith('#/design-system')) {
    return 'design-system';
  }
  return window.location.hash === '#/legal' ? 'legal' : 'product';
}

export default function App() {
  const [client] = useState(createMobileEngineClient);
  const [hostState, setHostState] = useState(startingState);
  const [error, setError] = useState<string | null>(null);
  const [surface, setSurface] = useState(currentSurface);

  useEffect(() => {
    const unsubscribeState = client.onState(state => {
      setHostState(state);
      setError(null);
    });
    const unsubscribeError = client.onError(setError);
    return () => {
      unsubscribeState();
      unsubscribeError();
      client.dispose();
    };
  }, [client]);

  useEffect(() => {
    const updateSurface = () => setSurface(currentSurface());
    window.addEventListener('hashchange', updateSurface);
    return () => window.removeEventListener('hashchange', updateSurface);
  }, []);

  const openLocal = async (
    passphrase: string,
    workspaceLabel: string,
  ): Promise<void> => {
    const state = await client.openLocal({
      kind: 'open-local',
      passphrase,
      actorLabel: 'Mobile Owner',
      workspaceLabel,
    });
    setHostState(state);
  };

  let content;
  if (surface === 'design-system') {
    content = <DesignSystemPage productPreview={<MobileProductPreview />} />;
  } else if (surface === 'legal') {
    content = <LegalPage />;
  } else {
    content = (
      <ProductShell
        error={error}
        hostState={hostState}
        onOpenLocal={openLocal}
      />
    );
  }

  return (
    <TooltipProvider>
      <ToastProvider>
        <Suspense fallback={<SurfaceLoading />}>{content}</Suspense>
      </ToastProvider>
    </TooltipProvider>
  );
}

function SurfaceLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <Spinner className="text-primary" label="Loading" />
    </div>
  );
}

function MobileProductPreview() {
  return (
    <ProductShell
      error={null}
      hostState={{
        phase: 'ready',
        vaultExists: true,
        actors: [
          { actorId: 'actor_preview', label: 'Mobile Owner', unlocked: true },
        ],
        workspaces: [
          { workspaceId: 'workspace_preview', label: 'Personal knowledge' },
        ],
      }}
      onOpenLocal={() => Promise.resolve()}
    />
  );
}
