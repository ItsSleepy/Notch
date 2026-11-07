import type { ComponentType } from 'react';

export interface PollCtx {
  /** The bar is on screen. */
  visible: boolean;
  /** Id of the widget whose card is open, if any. */
  openCard: string | null;
  /** Fullscreen app, anti-cheat game, or paused from the tray. All polling should stop. */
  suspended: boolean;
  /** A game is focused (windowed/borderless). Poll less. */
  game: boolean;
}

export interface ChipProps {
  /** This widget's card is open. */
  open: boolean;
}

export interface CardProps {
  close: () => void;
  openSettings: () => void;
}

/**
 * A widget is one item in the bar plus (optionally) the card that drops down under it.
 * Register it in src/widgets/index.ts.
 * - slot: which part of the bar the chip sits in
 * - Chip: the small item in the bar
 * - Card: what opens under it (hover or click)
 * - onWheel: scrolling anywhere on the bar (the first widget that defines it handles it)
 * - poll: the shell runs tick() on the interval you return; return null to pause
 */
export interface WidgetDef {
  id: string;
  title: string;
  order: number;
  slot: 'left' | 'center' | 'right';
  Chip: ComponentType<ChipProps>;
  Card?: ComponentType<CardProps>;
  /** Card width in px (default 300). */
  cardWidth?: number;
  onWheel?: (deltaY: number) => void;
  poll?: {
    interval: (ctx: PollCtx) => number | null;
    tick: () => Promise<void> | void;
  };
  onSuspend?: () => void;
}
