// Per-key throttle that always delivers the last call (so a slider's final position sticks).

const slots = new Map<string, { last: number; timer: number | null; fn: () => void }>();

export function throttled(key: string, fn: () => void, wait = 60) {
  let slot = slots.get(key);
  if (!slot) {
    slot = { last: 0, timer: null, fn };
    slots.set(key, slot);
  }
  slot.fn = fn;
  const s = slot;
  const remaining = wait - (Date.now() - s.last);
  if (remaining <= 0) {
    s.last = Date.now();
    fn();
  } else if (s.timer === null) {
    s.timer = window.setTimeout(() => {
      s.timer = null;
      s.last = Date.now();
      s.fn();
    }, remaining);
  }
}
