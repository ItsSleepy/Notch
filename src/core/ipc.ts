import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mockCall, mockListen } from './mock';

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** invoke() inside Tauri; fake data in a plain browser so `npm run dev` works as a design sandbox. */
export function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return inTauri ? invoke<T>(cmd, args) : mockCall<T>(cmd, args);
}

async function on<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  if (!inTauri) return mockListen(event, cb as (p: unknown) => void);
  return listen<T>(event, (e) => cb(e.payload));
}

export interface Config {
  anticheatProcesses: string[];
  suspendOnFullscreen: boolean;
  hoverExpand: boolean;
  autoHide: boolean;
  revealDelayMs: number;
  calendarUrls: string[];
  clock24h: boolean;
  gameMode: boolean;
  gameProcesses: string[];
  lhmEnabled: boolean;
  lhmUrl: string;
}

export interface SuspendInfo {
  fullscreen: boolean;
  anticheat: boolean;
  userHidden: boolean;
  /** A game is focused: poll less (not a suspend). */
  game: boolean;
}

export const BAR_H = 32;

export const barResize = (height: number) => call<void>('bar_resize', { height });
export const barSetHold = (hold: boolean) => call<void>('bar_set_hold', { hold });
export const barPeek = (ms: number) => call<void>('bar_peek', { ms });
export const barDismiss = () => call<void>('bar_dismiss');
export const barVisible = () => call<boolean>('bar_visible');
export const openTarget = (target: 'spotify' | 'taskmgr' | 'calendar' | 'sound' | 'clock') =>
  call<void>('open_target', { target });
export const quitApp = () => call<void>('quit_app');

export const getConfig = () => call<Config>('get_config');
export const setConfig = (config: Config) => call<void>('set_config', { config });
export const getSuspend = () => call<SuspendInfo>('get_suspend');

export const onSuspend = (cb: (s: SuspendInfo) => void) => on<SuspendInfo>('notch://suspend', cb);
export const onBarVisibility = (cb: (v: { visible: boolean }) => void) =>
  on<{ visible: boolean }>('bar://visibility', cb);

/** Config shared by widgets (clock format, calendar links). Set once the app has loaded it. */
let currentConfig: Config | null = null;
const configListeners = new Set<() => void>();
export const configStore = {
  get: () => currentConfig,
  set: (c: Config) => {
    currentConfig = c;
    configListeners.forEach((l) => l());
  },
  subscribe: (l: () => void) => {
    configListeners.add(l);
    return () => {
      configListeners.delete(l);
    };
  },
};
