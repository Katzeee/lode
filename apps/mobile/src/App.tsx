import { useCallback, useRef, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import type { NativeStorageRequest } from './engine-host-protocol';
import { MobileDesignSystemPage } from './design-system/design-system-page';
import { describeError, parseHostMessage } from './host-message';
import { MobileLegalPage } from './legal-page';
import { database, executeStorageOperation } from './native-database';
import { ProductShell } from './product-shell';
import { startingState, type MobileSurface } from './mobile-shell-state';
import { ThemeProvider } from './ui/theme';

function App() {
  return (
    <SafeAreaProvider>
      <MobileShell />
    </SafeAreaProvider>
  );
}

function MobileShell() {
  const webView = useRef<WebView<object>>(null);
  const [hostState, setHostState] = useState(startingState);
  const [passphrase, setPassphrase] = useState('');
  const [workspaceLabel, setWorkspaceLabel] = useState('My Workspace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [surface, setSurface] = useState<MobileSurface>('product');

  const respondToNative = useCallback(
    (id: string, response: Readonly<Record<string, unknown>>) => {
      webView.current?.postMessage(
        JSON.stringify({ type: 'native-storage-response', id, ...response }),
      );
    },
    [],
  );

  const handleNativeStorage = useCallback(
    async (request: NativeStorageRequest) => {
      if (database === undefined) {
        respondToNative(request.id, {
          ok: false,
          error: 'The Android SQLite module is unavailable',
        });
        return;
      }
      try {
        const value = await executeStorageOperation(
          database,
          request.operation,
        );
        respondToNative(request.id, { ok: true, value });
      } catch (caught: unknown) {
        respondToNative(request.id, {
          ok: false,
          error: describeError(caught),
        });
      }
    },
    [respondToNative],
  );

  const receiveHostMessage = useCallback(
    (source: string) => {
      try {
        const message = parseHostMessage(source);
        if (message.type === 'native-storage-request') {
          void handleNativeStorage(message);
          return;
        }
        if (message.type === 'engine-state') {
          setHostState(message.state);
          setError(null);
          return;
        }
        if (message.type === 'engine-error') {
          setError(message.message);
          setBusy(false);
          return;
        }
        if (message.type === 'engine-command-response') {
          setBusy(false);
          if (message.ok && message.state !== undefined) {
            setHostState(message.state);
            setPassphrase('');
            setError(null);
          } else {
            setError(message.error ?? 'The Engine command failed');
          }
        }
      } catch (caught: unknown) {
        setError(describeError(caught));
        setBusy(false);
      }
    },
    [handleNativeStorage],
  );

  const openLocal = useCallback(() => {
    if (passphrase.length < 8) {
      setError('Passphrase must contain at least 8 characters.');
      return;
    }
    if (workspaceLabel.trim().length === 0) {
      setError('Workspace name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    webView.current?.postMessage(
      JSON.stringify({
        type: 'engine-command',
        id: `open-${Date.now()}`,
        command: {
          kind: 'open-local',
          passphrase,
          actorLabel: 'Mobile Owner',
          workspaceLabel: workspaceLabel.trim(),
        },
      }),
    );
  }, [passphrase, workspaceLabel]);

  return (
    <View style={styles.screen}>
      <StatusBar
        barStyle={surface === 'product' ? 'light-content' : 'dark-content'}
      />
      {surface === 'design-system' ? (
        <MobileDesignSystemPage onClose={() => setSurface('product')} />
      ) : surface === 'legal' ? (
        <ThemeProvider mode="light">
          <MobileLegalPage onClose={() => setSurface('product')} />
        </ThemeProvider>
      ) : (
        <ThemeProvider mode="dark">
          <ProductShell
            busy={busy}
            error={error}
            hostState={hostState}
            onNavigate={setSurface}
            onOpenLocal={openLocal}
            onPassphraseChange={setPassphrase}
            onWorkspaceLabelChange={setWorkspaceLabel}
            passphrase={passphrase}
            workspaceLabel={workspaceLabel}
          />
        </ThemeProvider>
      )}

      <View
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.engineHostContainer}
      >
        <WebView<object>
          ref={webView}
          allowFileAccess
          javaScriptEnabled
          originWhitelist={['file://*']}
          source={{ uri: 'file:///android_asset/lode-engine/index.html' }}
          onMessage={event => receiveHostMessage(event.nativeEvent.data)}
          style={styles.engineHost}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  engineHostContainer: {
    bottom: 0,
    height: 1,
    left: 0,
    opacity: 0.01,
    overflow: 'hidden',
    position: 'absolute',
    width: 1,
  },
  engineHost: { flex: 1 },
});

export default App;
