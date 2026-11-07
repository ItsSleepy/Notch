import { useEffect, useState } from 'react';
import { barPeek, call, inTauri, openTarget } from '../../core/ipc';
import { createStore, useStore } from '../../core/store';
import { Card } from '../../core/Card';
import { IconClose, IconPause, IconPlay, IconPlus, IconTimer } from '../../core/icons';
import { useNow } from '../../core/useNow';
import type { CardProps, ChipProps, WidgetDef } from '../../core/types';
import { listen } from '@tauri-apps/api/event';

// Several named countdown timers. They're kept in localStorage so they survive a restart, and
// the end times are handed to the Rust side, which pops the bar open when one finishes even if
// the (hidden) webview is being throttled.

interface Timer {
  id: string;
  label: string;
  totalMs: number;
  /** Set while running. */
  endsAt: number | null;
  /** Time left while paused. */
  leftMs: number;
  done: boolean;
}

const KEY = 'notch.timers';

function load(): Timer[] {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}

const store = createStore<Timer[]>(load());

function save(next: Timer[]) {
  store.set(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full / blocked: timers still work for this session */
  }
  call('timer_alarms', { ends: next.filter((t) => t.endsAt && !t.done).map((t) => t.endsAt) }).catch(() => {});
  schedule();
}

const left = (t: Timer, now: number) => (t.done ? 0 : t.endsAt ? Math.max(0, t.endsAt - now) : t.leftMs);

function fmt(ms: number) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function startTimer(minutes: number, label = '') {
  const ms = Math.round(minutes * 60_000);
  if (!(ms > 0)) return;
  const t: Timer = {
    id: Math.random().toString(36).slice(2, 9),
    label: label.trim() || (minutes >= 1 ? `${minutes} min` : `${Math.round(minutes * 60)} sec`),
    totalMs: ms,
    endsAt: Date.now() + ms,
    leftMs: ms,
    done: false,
  };
  save([...store.get(), t]);
}

const update = (id: string, f: (t: Timer) => Timer) => save(store.get().map((t) => (t.id === id ? f(t) : t)));
const pause = (id: string) => update(id, (t) => ({ ...t, leftMs: left(t, Date.now()), endsAt: null }));
const resume = (id: string) => update(id, (t) => ({ ...t, endsAt: Date.now() + t.leftMs }));
const addMinute = (id: string) =>
  update(id, (t) =>
    t.done
      ? { ...t, done: false, endsAt: Date.now() + 60_000, leftMs: 60_000, totalMs: 60_000 }
      : t.endsAt
        ? { ...t, endsAt: t.endsAt + 60_000, totalMs: t.totalMs + 60_000 }
        : { ...t, leftMs: t.leftMs + 60_000, totalMs: t.totalMs + 60_000 },
  );
const remove = (id: string) => save(store.get().filter((t) => t.id !== id));

// ---------- finishing ----------

let finishTimer: number | undefined;

/** Wakes up at the next end time (the Rust alarm covers us if this one is late). */
function schedule() {
  window.clearTimeout(finishTimer);
  const next = Math.min(...store.get().filter((t) => t.endsAt && !t.done).map((t) => t.endsAt!));
  if (!Number.isFinite(next)) return;
  finishTimer = window.setTimeout(checkFinished, Math.max(0, next - Date.now()) + 30);
}

function checkFinished() {
  const now = Date.now();
  let any = false;
  const next = store.get().map((t) => {
    if (!t.done && t.endsAt && t.endsAt <= now) {
      any = true;
      return { ...t, done: true, endsAt: null, leftMs: 0 };
    }
    return t;
  });
  if (any) {
    save(next);
    chime();
    barPeek(8000).catch(() => {});
  } else {
    schedule();
  }
}

function chime() {
  try {
    const ctx = new AudioContext();
    [0, 0.28, 0.56].forEach((at) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.25);
    });
    window.setTimeout(() => ctx.close(), 1200);
  } catch {
    /* no audio device */
  }
}

// Start-up: catch timers that ended while the app was closed, and hand alarms to Rust.
save(store.get());
checkFinished();
if (inTauri) listen('bar://alarm', () => checkFinished()).catch(() => {});

// ---------- UI ----------

function Ring({ t, now }: { t: Timer; now: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const frac = t.totalMs > 0 ? left(t, now) / t.totalMs : 0;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" className={`t-ring${t.done ? ' done' : ''}`}>
      <circle cx="12" cy="12" r={r} className="t-track" />
      <circle cx="12" cy="12" r={r} className="t-value" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 12 12)" />
    </svg>
  );
}

function soonest(timers: Timer[], now: number) {
  const running = timers.filter((t) => t.endsAt && !t.done).sort((a, b) => a.endsAt! - b.endsAt!);
  return { running, first: running[0], ringing: timers.filter((t) => t.done), next: running[0] ? left(running[0], now) : null };
}

function Chip({ open }: ChipProps) {
  const timers = useStore(store);
  const live = timers.some((t) => t.endsAt && !t.done);
  const now = useNow(1000, live);
  const { first, ringing } = soonest(timers, now);
  const paused = timers.filter((t) => !t.endsAt && !t.done);
  return (
    <span className={`chip timer-chip${open ? ' on' : ''}${ringing.length ? ' ringing' : ''}${first || ringing.length ? '' : ' icon-only'}`}>
      <IconTimer size={13} />
      {ringing.length > 0 ? (
        <span>{ringing[0].label} done</span>
      ) : first ? (
        <span className="num">{fmt(left(first, now))}</span>
      ) : paused.length > 0 ? (
        <span className="num muted">{fmt(paused[0].leftMs)}</span>
      ) : null}
    </span>
  );
}

function TimersCard({ openSettings }: CardProps) {
  const timers = useStore(store);
  const now = useNow(1000, timers.some((t) => t.endsAt && !t.done));
  const { running, next } = soonest(timers, now);
  const [mins, setMins] = useState('');
  const [label, setLabel] = useState('');

  // Seeing a finished timer counts as acknowledging the chime; keep it listed until dismissed.
  useEffect(() => {
    checkFinished();
  }, []);

  const custom = () => {
    const m = parseFloat(mins.replace(',', '.'));
    if (m > 0) {
      startTimer(m, label);
      setMins('');
      setLabel('');
    }
  };

  return (
    <Card
      icon={<IconTimer size={15} />}
      tone="orange"
      title="Timers"
      subtitle={running.length ? `${running.length} running` : timers.length ? 'Paused or done' : 'None running'}
      value={next !== null ? fmt(next) : undefined}
      action={{ label: 'Clock app', onClick: () => openTarget('clock') }}
      openSettings={openSettings}
    >
      {timers.length > 0 && (
        <div className="panel timers">
          {timers.map((t) => (
            <div className={`t-row${t.done ? ' done' : ''}`} key={t.id}>
              <Ring t={t} now={now} />
              <div className="t-text">
                <div className="t-time num">{t.done ? 'Done' : fmt(left(t, now))}</div>
                <div className="t-label muted">{t.label}</div>
              </div>
              {!t.done && (
                <button className="round-btn" aria-label={t.endsAt ? 'Pause' : 'Resume'} onClick={() => (t.endsAt ? pause(t.id) : resume(t.id))}>
                  {t.endsAt ? <IconPause size={11} /> : <IconPlay size={11} />}
                </button>
              )}
              <button className="round-btn" aria-label="Add a minute" onClick={() => addMinute(t.id)}>
                <IconPlus size={11} />
              </button>
              <button className="round-btn" aria-label="Remove" onClick={() => remove(t.id)}>
                <IconClose size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="panel">
        <div className="sec-label">Start a timer</div>
        <div className="quick">
          {[1, 5, 10, 25].map((m) => (
            <button key={m} className="pill-btn" onClick={() => startTimer(m, label)}>
              {m} min
            </button>
          ))}
        </div>
        <div className="custom">
          <input className="text" placeholder="Name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} />
          <input
            className="text mins"
            placeholder="min"
            inputMode="decimal"
            value={mins}
            onChange={(e) => setMins(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && custom()}
          />
          <button className="pill-btn" onClick={custom} disabled={!(parseFloat(mins.replace(',', '.')) > 0)}>
            Start
          </button>
        </div>
      </div>
    </Card>
  );
}

export const timersWidget: WidgetDef = {
  id: 'timers',
  title: 'Timers',
  order: 20,
  slot: 'right',
  Chip,
  Card: TimersCard,
  cardWidth: 300,
};
