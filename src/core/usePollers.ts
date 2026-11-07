import { useEffect } from 'react';
import { getWidgets } from './registry';
import type { PollCtx } from './types';

/**
 * Runs every widget's poll loop. Loops restart whenever the notch opens/closes, is
 * suspended, or a game gains focus, so each widget can poll fast when open, slowly when
 * collapsed, or not at all.
 */
export function usePollers(ctx: PollCtx) {
  const { expanded, suspended, game } = ctx;

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];

    getWidgets().forEach((w, i) => {
      const poll = w.poll;
      if (!poll) return;
      const ms = poll.interval({ expanded, suspended, game });
      if (ms === null) return;

      const loop = async () => {
        if (cancelled) return;
        try {
          await poll.tick();
        } catch (err) {
          console.warn(`[${w.id}] poll failed`, err);
        }
        if (!cancelled) timers[i] = window.setTimeout(loop, ms);
      };
      loop();
    });

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [expanded, suspended, game]);

  useEffect(() => {
    if (suspended) getWidgets().forEach((w) => w.onSuspend?.());
  }, [suspended]);
}
