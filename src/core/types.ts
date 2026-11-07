import type { ComponentType } from 'react';

export interface PollCtx {
  /** Notch is open. */
  expanded: boolean;
  /** Fullscreen app, anti-cheat game, or hidden from the tray. All polling should stop. */
  suspended: boolean;
  /** A game is focused (windowed/borderless). Poll less. */
  game: boolean;
}

export interface PanelProps {
  expanded: boolean;
}

/**
 * A widget is a self-contained feature. Register it in src/widgets/index.ts.
 * - Compact: content for the collapsed pill (the first widget with one, by order, wins)
 * - Panel: content for the expanded notch
 * - activity: a temporary "live activity" that takes over the pill while useActive() is true
 * - onWheel: scrolling over the pill (first widget that defines it handles it)
 * - poll: the shell runs tick() on the interval you return; return null to pause
 */
export interface WidgetDef {
  id: string;
  title: string;
  order: number;
  /** Columns the panel takes in the 2-column expanded grid. */
  span?: 1 | 2;
  Compact?: ComponentType;
  Panel?: ComponentType<PanelProps>;
  activity?: {
    /** Hook: must be safe to call on every render. */
    useActive: () => boolean;
    Compact: ComponentType;
  };
  onWheel?: (deltaY: number) => void;
  poll?: {
    interval: (ctx: PollCtx) => number | null;
    tick: () => Promise<void> | void;
  };
  onSuspend?: () => void;
}
