import { useEffect, useState, useSyncExternalStore } from 'react';
import { configStore } from './ipc';

/** Re-renders every `ms` (aligned to the clock) and returns Date.now(). */
export function useNow(ms: number, enabled = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    let t: number;
    const tick = () => {
      setNow(Date.now());
      t = window.setTimeout(tick, ms - (Date.now() % ms) + 5);
    };
    t = window.setTimeout(tick, ms - (Date.now() % ms) + 5);
    return () => window.clearTimeout(t);
  }, [ms, enabled]);
  return now;
}

export function useConfig() {
  return useSyncExternalStore(configStore.subscribe, configStore.get);
}

/** "9:50" / "9:50 AM" depending on the clock setting. */
export function fmtTime(ms: number, h24: boolean) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: !h24 }).format(ms);
}

export function startOfDay(ms: number, addDays = 0) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + addDays);
  return d.getTime();
}
