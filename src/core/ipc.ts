import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mockCall } from './mock';

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** invoke() inside Tauri; fake data in a plain browser so `npm run dev` works as a design sandbox. */
export function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return inTauri ? invoke<T>(cmd, args) : mockCall<T>(cmd, args);
}

export interface Config {
  anticheatProcesses: string[];
  suspendOnFullscreen: boolean;
  hoverExpand: boolean;
  gameMode: boolean;
  gameProcesses: string[];
  lhmEnabled: boolean;
  lhmUrl: string;
}

export interface SuspendInfo {
  fullscreen: boolean;
  anticheat: boolean;
  userHidden: boolean;
  /** A game is focused: the notch goes minimal (not a suspend). */
  game: boolean;
}

export const resizeNotch = (width: number, height: number) =>
  call<void>('resize_notch', { width, height });
export const getConfig = () => call<Config>('get_config');
export const setConfig = (config: Config) => call<void>('set_config', { config });
export const getSuspend = () => call<SuspendInfo>('get_suspend');

export async function onSuspend(cb: (s: SuspendInfo) => void): Promise<() => void> {
  if (!inTauri) return () => {};
  return listen<SuspendInfo>('notch://suspend', (e) => cb(e.payload));
}
