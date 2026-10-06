import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CommandRecord, DeviceRecord } from '@remote/protocol';
import { api, ApiError, eventsUrl, type GatewayStatus } from './api.ts';
import { loadPrefs, savePrefs, type Prefs } from './prefs.ts';

type Phase = 'loading' | 'offline' | 'anonymous' | 'ready';

interface GatewayValue {
  phase: Phase;
  devices: DeviceRecord[];
  demoEnabled: boolean;
  online: boolean;
  controlsReady: boolean;
  status: GatewayStatus | null;
  lastCommand: CommandRecord | null;
  notice: string | null;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => Promise<void>;
  sendCommand: (
    device: DeviceRecord,
    capability: string,
    args?: Record<string, unknown>,
  ) => Promise<CommandRecord>;
  pair: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
  remember: (id: string) => void;
  setLastCommand: (command: CommandRecord | null) => void;
  replaceDevices: (devices: DeviceRecord[], demoEnabled: boolean) => void;
}

const GatewayContext = createContext<GatewayValue | null>(null);

export function GatewayProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [online, setOnline] = useState(false);
  const [controlsReady, setControlsReady] = useState(false);
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>({
    theme: 'system',
    vibrate: false,
    lastDeviceId: null,
    cachedDevices: [],
    demoEnabled: false,
  });
  const sequences = useRef(new Map<string, number>());
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  const applyTheme = useCallback((theme: Prefs['theme']) => {
    const dark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    const color = document.querySelector('meta[name="theme-color"]');
    color?.setAttribute('content', dark ? '#12100e' : '#f7f3ec');
  }, []);

  const remember = useCallback((id: string) => {
    void savePrefs({ ...prefsRef.current, lastDeviceId: id }).then(setPrefsState);
  }, []);

  const replaceDevices = useCallback((next: DeviceRecord[], demo: boolean) => {
    setDevices(next);
    setDemoEnabled(demo);
    for (const device of next) {
      const current = sequences.current.get(device.id) ?? 0;
      if (device.lastSequence > current) sequences.current.set(device.id, device.lastSequence);
    }
    void savePrefs({ ...prefsRef.current, cachedDevices: next, demoEnabled: demo }).then(
      setPrefsState,
    );
  }, []);

  const loadLibrary = useCallback(async () => {
    const [library, gatewayStatus] = await Promise.all([api.devices(), api.status()]);
    setStatus(gatewayStatus);
    replaceDevices(library.devices, library.demoEnabled);
  }, [replaceDevices]);

  const armControls = useCallback(async () => {
    setControlsReady(false);
    try {
      await api.refreshAll();
      await loadLibrary();
      setOnline(true);
      setControlsReady(true);
      setNotice(null);
    } catch (error) {
      await loadLibrary().catch(() => undefined);
      setOnline(true);
      setControlsReady(false);
      setNotice(
        error instanceof ApiError
          ? error.message
          : 'Controls stay off until the gateway can refresh device state.',
      );
    }
  }, [loadLibrary]);

  const reload = useCallback(async () => {
    setPhase('loading');
    const stored = await loadPrefs();
    setPrefsState(stored);
    applyTheme(stored.theme);
    try {
      await api.health();
    } catch {
      setDevices(stored.cachedDevices);
      setDemoEnabled(stored.demoEnabled);
      setOnline(false);
      setControlsReady(false);
      setNotice(
        'The gateway is unreachable. Saved remotes stay visible, and no commands will be sent.',
      );
      setPhase(stored.cachedDevices.length > 0 ? 'ready' : 'offline');
      return;
    }
    try {
      await api.session();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setPhase('anonymous');
        setOnline(true);
        return;
      }
      setPhase('offline');
      setOnline(false);
      setNotice('The gateway did not answer. Nothing was queued.');
      return;
    }
    setPhase('ready');
    await armControls();
  }, [applyTheme, armControls]);

  useEffect(() => {
    // Load gateway state once the session helpers are ready.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload fetches and stores the result
    void reload();
  }, [reload]);

  useEffect(() => {
    if (prefs.theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [applyTheme, prefs.theme]);

  useEffect(() => {
    if (phase !== 'ready') return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let delay = 500;
    let timer = 0;

    const connect = () => {
      socket = new WebSocket(eventsUrl());
      socket.onopen = () => {
        delay = 500;
        void armControls();
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as {
          type: string;
          command?: CommandRecord;
          deviceId?: string;
          state?: DeviceRecord['state'];
        };
        if (message.type === 'command' && message.command) setLastCommand(message.command);
        if (message.type === 'state' && message.deviceId && message.state) {
          const deviceId = message.deviceId;
          const state = message.state;
          setDevices((current) =>
            current.map((device) => (device.id === deviceId ? { ...device, state } : device)),
          );
        }
        if (message.type === 'devices' || message.type === 'demo')
          void loadLibrary().catch(() => undefined);
      };
      socket.onclose = () => {
        setOnline(false);
        setControlsReady(false);
        setNotice('The gateway connection dropped. Commands stay disabled until it reconnects.');
        if (stopped) return;
        timer = window.setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, [armControls, loadLibrary, phase]);

  const value = useMemo<GatewayValue>(() => {
    return {
      phase,
      devices,
      demoEnabled,
      online,
      controlsReady,
      status,
      lastCommand,
      notice,
      prefs,
      setPrefs: async (patch) => {
        const next = await savePrefs({ ...prefs, ...patch });
        setPrefsState(next);
        applyTheme(next.theme);
      },
      sendCommand: async (device, capability, args = {}) => {
        if (!online || !controlsReady) {
          throw new ApiError(
            0,
            'gateway_unreachable',
            'The gateway is disconnected. Nothing was queued.',
          );
        }
        const sequence = (sequences.current.get(device.id) ?? device.lastSequence) + 1;
        sequences.current.set(device.id, sequence);
        if (prefs.vibrate && 'vibrate' in navigator) navigator.vibrate(12);
        const result = await api.command(device.id, {
          id: crypto.randomUUID(),
          capability,
          arguments: args,
          sequence,
        });
        setLastCommand(result.command);
        return result.command;
      },
      pair: async (code) => {
        await api.pair(code);
        setPhase('ready');
        await armControls();
      },
      signOut: async () => {
        await api.signOut();
        setPhase('anonymous');
        setControlsReady(false);
      },
      reload,
      remember,
      setLastCommand,
      replaceDevices,
    };
  }, [
    applyTheme,
    armControls,
    controlsReady,
    demoEnabled,
    devices,
    lastCommand,
    notice,
    online,
    phase,
    prefs,
    reload,
    remember,
    replaceDevices,
    status,
  ]);

  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>;
}

export function useGateway(): GatewayValue {
  const value = useContext(GatewayContext);
  if (!value) throw new Error('Gateway state is unavailable.');
  return value;
}
