import type { DeviceRecord } from '@remote/protocol';

export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  vibrate: boolean;
  lastDeviceId: string | null;
  cachedDevices: DeviceRecord[];
  demoEnabled: boolean;
}

const DEFAULTS: Prefs = {
  theme: 'system',
  vibrate: false,
  lastDeviceId: null,
  cachedDevices: [],
  demoEnabled: false,
};

let memory = { ...DEFAULTS };

export async function loadPrefs(): Promise<Prefs> {
  try {
    const db = await openDb();
    const stored = await read(db);
    memory = { ...DEFAULTS, ...stored };
  } catch {
    memory = { ...DEFAULTS };
  }
  return memory;
}

export async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  memory = { ...memory, ...patch };
  try {
    const db = await openDb();
    await write(db, memory);
  } catch {
    /* Preferences still apply for this session if storage is blocked. */
  }
  if (memory.theme === 'light' || memory.theme === 'dark')
    localStorage.setItem('remote-theme', memory.theme);
  else localStorage.removeItem('remote-theme');
  return memory;
}

function errorFrom(error: DOMException | null): Error {
  return error ?? new Error('IndexedDB request failed.');
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('remote-prefs', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('prefs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(errorFrom(request.error));
  });
}

function read(db: IDBDatabase): Promise<Partial<Prefs> | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction('prefs').objectStore('prefs').get('main');
    request.onsuccess = () => resolve(request.result as Partial<Prefs> | undefined);
    request.onerror = () => reject(errorFrom(request.error));
  });
}

function write(db: IDBDatabase, prefs: Prefs): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction('prefs', 'readwrite').objectStore('prefs').put(prefs, 'main');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(errorFrom(request.error));
  });
}
