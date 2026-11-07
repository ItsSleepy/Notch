import { useEffect } from 'react';
import { getWidgets } from './registry';
import type { PollCtx } from './types';

/**
 * Runs every widget's poll loop. Loops restart whenever the bar shows/hides, a card opens or
 * closes, the app is suspended, or a game gains focus, so each widget can poll fast while its
 * card is open, slowly while only the bar is up, and not at all while hidden.
 */
export function usePollers(ctx: PollCtx) {
  const { visible, openCard, suspended, game } = ctx;

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];

    getWidgets().forEach((w, i) => {
      const poll = w.poll;
      if (!poll) return;
      const ms = poll.interval({ visible, openCard, suspended, game });
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
  }, [visible, openCard, suspended, game]);

  useEffect(() => {
    if (suspended) getWidgets().forEach((w) => w.onSuspend?.());
  }, [suspended]);
}
