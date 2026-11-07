import type { CSSProperties } from 'react';
import { call, openTarget } from '../../core/ipc';
import { createStore, useStore } from '../../core/store';
import { Card } from '../../core/Card';
import { IconCalendar } from '../../core/icons';
import { fmtTime, startOfDay, useConfig, useNow } from '../../core/useNow';
import type { CardProps, ChipProps, WidgetDef } from '../../core/types';

// Today's events and the next one, from iCal feeds (e.g. Google Calendar's secret iCal link).
// The Rust side fetches and caches the feeds; this just asks every minute while the bar is up.

interface CalEvent {
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  cal: number;
}

interface CalendarData {
  configured: boolean;
  events: CalEvent[];
  error: string | null;
  fetchedAt: number;
}

const store = createStore<CalendarData | null>(null);

async function tick() {
  store.set(await call<CalendarData>('calendar_events', { force: false }));
}

export const refreshCalendar = async () => {
  store.set(await call<CalendarData>('calendar_events', { force: true }));
};

const COLORS = ['var(--green)', 'var(--blue)', 'var(--orange)', 'var(--purple)', 'var(--red)'];
const colorOf = (e: CalEvent) => COLORS[e.cal % COLORS.length];

function relative(ms: number) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${Math.max(1, mins)} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

/** Events that touch today, and the first timed event after today. */
function split(events: CalEvent[], now: number) {
  const today0 = startOfDay(now);
  const tomorrow0 = startOfDay(now, 1);
  const today = events.filter((e) => e.start < tomorrow0 && e.end > today0);
  const later = events.filter((e) => e.start >= tomorrow0);
  const upcomingToday = today.filter((e) => !e.allDay && e.end > now);
  return { today, later, upcomingToday };
}

function dayLabel(ms: number, now: number) {
  const day = startOfDay(ms);
  if (day === startOfDay(now, 1)) return 'Tomorrow';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(ms);
}

function Chip({ open }: ChipProps) {
  const data = useStore(store);
  const config = useConfig();
  const now = useNow(30_000);
  const h24 = config?.clock24h ?? true;
  const next = data ? split(data.events, now).upcomingToday[0] : undefined;

  return (
    <span className={`chip cal-chip${open ? ' on' : ''}`}>
      <IconCalendar size={13} />
      {next ? (
        <span className="cal-next">
          <span className="cal-title">{next.title}</span>
          <span className="muted">{' · '}{next.start <= now ? 'now' : fmtTime(next.start, h24)}</span>
        </span>
      ) : (
        <span>{new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(now)}</span>
      )}
    </span>
  );
}

function EventRow({ e, now, h24 }: { e: CalEvent; now: number; h24: boolean }) {
  const past = !e.allDay && e.end <= now;
  const live = !e.allDay && e.start <= now && e.end > now;
  let when: string;
  if (e.allDay) when = 'All day';
  else if (live) when = `Now · until ${fmtTime(e.end, h24)}`;
  else when = `${fmtTime(e.start, h24)} – ${fmtTime(e.end, h24)}${e.start > now ? ` · ${relative(e.start - now)}` : ''}`;
  return (
    <div className={`ev${past ? ' past' : ''}`} style={{ '--ev': colorOf(e) } as CSSProperties}>
      <div className="ev-title">{e.title}</div>
      <div className={`ev-when${e.allDay ? ' allday' : ''}`}>{when}</div>
    </div>
  );
}

function CalendarCard({ openSettings }: CardProps) {
  const data = useStore(store);
  const config = useConfig();
  const now = useNow(30_000);
  const h24 = config?.clock24h ?? true;
  const { today, later, upcomingToday } = split(data?.events ?? [], now);
  const next = later.find((e) => !e.allDay) ?? later[0];
  const left = today.filter((e) => e.allDay || e.end > now).length;

  return (
    <Card
      icon={<IconCalendar size={15} />}
      tone="red"
      title={new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(now)}
      subtitle={new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(now)}
      value={data?.configured ? left : undefined}
      valueNote={data?.configured ? (left === 1 ? 'event left' : 'events left') : undefined}
      action={{ label: 'Google Calendar', onClick: () => openTarget('calendar') }}
      openSettings={openSettings}
    >
      {!data ? (
        <div className="panel muted small">Loading…</div>
      ) : !data.configured ? (
        <div className="panel">
          <div className="small">Show your Google Calendar here.</div>
          <div className="muted small" style={{ marginTop: 4 }}>
            In Google Calendar: Settings › your calendar › <b>Secret address in iCal format</b>. Copy it, then paste it
            into Notch's settings under Calendar.
          </div>
          <button className="pill-btn" style={{ marginTop: 8 }} onClick={openSettings}>
            Open settings
          </button>
        </div>
      ) : (
        <div className="panel">
          <div className="sec-label">Today</div>
          {today.length === 0 ? (
            <div className="muted small">Nothing on today.</div>
          ) : (
            today.map((e, i) => <EventRow key={`${e.start}-${i}`} e={e} now={now} h24={h24} />)
          )}
          {next && (
            <div className="kv next">
              <span>
                <span className="muted">Next </span>
                <b>{next.title}</b>
              </span>
              <span className="muted">
                {dayLabel(next.start, now)}
                {next.allDay ? '' : `, ${fmtTime(next.start, h24)}`}
              </span>
            </div>
          )}
          {upcomingToday.length === 0 && today.length > 0 && !next && <div className="muted small">All done for today.</div>}
          {data.error && <div className="err small">{data.error}</div>}
        </div>
      )}
    </Card>
  );
}

export const calendarWidget: WidgetDef = {
  id: 'calendar',
  title: 'Calendar',
  order: 5,
  slot: 'left',
  Chip,
  Card: CalendarCard,
  cardWidth: 300,
  poll: {
    // The backend caches feeds for 5 minutes, so asking often is cheap.
    interval: ({ visible, openCard, suspended }) => (suspended || !visible ? null : openCard === 'calendar' ? 30_000 : 60_000),
    tick,
  },
};
