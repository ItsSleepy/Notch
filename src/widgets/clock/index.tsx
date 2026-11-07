import { fmtTime, useConfig, useNow } from '../../core/useNow';
import type { WidgetDef } from '../../core/types';

// Date and time at the right end of the bar. No card.

function Chip() {
  const config = useConfig();
  const now = useNow(1000);
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(now);
  return (
    <span className="chip clock-chip">
      <span className="muted">{date}</span>
      <span className="num">{fmtTime(now, config?.clock24h ?? true)}</span>
    </span>
  );
}

export const clockWidget: WidgetDef = {
  id: 'clock',
  title: 'Clock',
  order: 90,
  slot: 'right',
  Chip,
};
