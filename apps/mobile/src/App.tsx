import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import type {
  EngineHostState,
  NativeStorageRequest,
} from './engine-host-protocol';
import { describeError, parseHostMessage } from './host-message';
import { database, executeStorageOperation } from './native-database';
import { styles } from './styles';
const startingState: EngineHostState = {
  phase: 'starting',
  vaultExists: false,
  actors: [],
  workspaces: [],
};

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <MobileShell />
    </SafeAreaProvider>
  );
}

function MobileShell() {
  const insets = useSafeAreaInsets();
  const webView = useRef<WebView<object>>(null);
  const [hostState, setHostState] = useState(startingState);
  const [passphrase, setPassphrase] = useState('');
  const [workspaceLabel, setWorkspaceLabel] = useState('My Workspace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const ready = hostState.phase !== 'starting';
  const unlocked = hostState.phase === 'ready';

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 },
        ]}
      >
        <Text style={styles.eyebrow}>LODE MOBILE</Text>
        <Text style={styles.title}>Your local knowledge space</Text>
        <Text style={styles.intro}>
          The Engine runs locally and stores its authoritative data in native
          SQLite. This shell is the starting point for the mobile interface.
        </Text>

        <View style={styles.statusCard}>
          <View style={styles.statusHeading}>
            <View
              style={[
                styles.statusDot,
                unlocked
                  ? styles.statusReady
                  : ready
                    ? styles.statusLocked
                    : styles.statusStarting,
              ]}
            />
            <Text style={styles.statusTitle}>
              {unlocked
                ? 'Engine ready'
                : ready
                  ? hostState.vaultExists
                    ? 'Vault locked'
                    : 'Ready to initialize'
                  : 'Starting Engine'}
            </Text>
          </View>
          <Text style={styles.statusDetail}>
            {hostState.actors.length} actor
            {hostState.actors.length === 1 ? '' : 's'} ·{' '}
            {hostState.workspaces.length} workspace
            {hostState.workspaces.length === 1 ? '' : 's'}
          </Text>
        </View>

        {!unlocked && ready ? (
          <View style={styles.form}>
            {!hostState.vaultExists ? (
              <View>
                <Text style={styles.label}>Workspace name</Text>
                <TextInput
                  autoCapitalize="sentences"
                  onChangeText={setWorkspaceLabel}
                  placeholder="My Workspace"
                  placeholderTextColor="#697386"
                  style={styles.input}
                  value={workspaceLabel}
                />
              </View>
            ) : null}
            <View>
              <Text style={styles.label}>Vault passphrase</Text>
              <TextInput
                autoCapitalize="none"
                onChangeText={setPassphrase}
                onSubmitEditing={openLocal}
                placeholder="At least 8 characters"
                placeholderTextColor="#697386"
                secureTextEntry
                style={styles.input}
                value={passphrase}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={openLocal}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
                busy && styles.buttonDisabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#0d1713" />
              ) : (
                <Text style={styles.buttonText}>
                  {hostState.vaultExists ? 'Unlock Lode' : 'Create local space'}
                </Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {unlocked ? (
          <View style={styles.readyCard}>
            <Text style={styles.readyTitle}>
              {hostState.workspaces[0]?.label ?? 'Local Workspace'}
            </Text>
            <Text style={styles.readyDetail}>
              The production Engine is open. Product navigation and editors
              attach to this shell in the UI phase.
            </Text>
          </View>
        ) : null}

        {error !== null ? (
          <Text selectable style={styles.error}>
            {error}
          </Text>
        ) : null}
      </ScrollView>

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
  );
}

export default App;
