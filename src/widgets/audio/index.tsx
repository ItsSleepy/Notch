import { useEffect, useState } from 'react';
import { call } from '../../core/ipc';
import { createStore, useStore } from '../../core/store';
import { throttled } from '../../core/throttle';
import { Slider } from '../../core/Slider';
import { IconChevron, IconVolume } from '../../core/icons';
import type { CardProps, ChipProps, WidgetDef } from '../../core/types';
import { Card } from '../../core/Card';
import { openTarget } from '../../core/ipc';

// Master volume, output device switcher and per-app mixer (Windows Core Audio).
// Scrolling over the pill changes master volume and shows a volume "live activity".

interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

interface AudioApp {
  pid: number;
  exe: string;
  volume: number;
  muted: boolean;
  active: boolean;
}

interface AudioSnapshot {
  master: number;
  muted: boolean;
  devices: AudioDevice[];
  apps: AudioApp[];
}

interface AudioState {
  snap: AudioSnapshot | null;
  /** Ignore polls until this time, so a slider being dragged doesn't jump back. */
  holdUntil: number;
  /** Volume OSD in the pill is visible until this time. */
  flashUntil: number;
}

const store = createStore<AudioState>({ snap: null, holdUntil: 0, flashUntil: 0 });

async function tick() {
  const snap = await call<AudioSnapshot | null>('audio_snapshot');
  if (Date.now() < store.get().holdUntil) return;
  store.set({ ...store.get(), snap });
}

/** Optimistic local update, then a throttled backend call. */
function edit(key: string, mutate: (s: AudioSnapshot) => void, send: () => Promise<unknown>) {
  const cur = store.get();
  if (cur.snap) {
    const snap = structuredClone(cur.snap);
    mutate(snap);
    store.set({ ...cur, snap, holdUntil: Date.now() + 800 });
  }
  throttled(key, () => {
    send().catch((e) => console.warn('audio', e));
  });
}

const setMaster = (v: number) =>
  edit('master', (s) => ((s.master = v), (s.muted = false)), () => call('audio_set_master', { volume: v }));
const toggleMasterMute = () => {
  const muted = !store.get().snap?.muted;
  edit('master-mute', (s) => (s.muted = muted), () => call('audio_set_master_mute', { muted }));
};
const setApp = (pid: number, volume: number) =>
  edit(
    `app-${pid}`,
    (s) => s.apps.forEach((a) => a.pid === pid && ((a.volume = volume), (a.muted = false))),
    () => call('audio_set_app', { pid, volume, muted: false }),
  );
const toggleAppMute = (pid: number, muted: boolean) =>
  edit(
    `app-mute-${pid}`,
    (s) => s.apps.forEach((a) => a.pid === pid && (a.muted = muted)),
    () => call('audio_set_app', { pid, volume: null, muted }),
  );
const setDevice = (id: string) =>
  edit(
    'device',
    (s) => s.devices.forEach((d) => (d.isDefault = d.id === id)),
    async () => {
      await call('audio_set_device', { id });
      window.setTimeout(() => tick().catch(() => {}), 300);
    },
  );

/** Scroll over the pill: ±2% per notch, shows the OSD. */
async function onWheel(deltaY: number) {
  const delta = deltaY < 0 ? 0.02 : -0.02;
  const cur = store.get();
  const optimistic = Math.min(1, Math.max(0, (cur.snap?.master ?? 0.5) + delta));
  store.set({
    ...cur,
    snap: cur.snap ? { ...cur.snap, master: optimistic, muted: false } : cur.snap,
    flashUntil: Date.now() + 1400,
    holdUntil: Date.now() + 800,
  });
  try {
    const level = await call<number>('audio_nudge_master', { delta });
    const s = store.get();
    store.set({
      ...s,
      snap: s.snap ? { ...s.snap, master: level, muted: false } : { master: level, muted: false, devices: [], apps: [] },
    });
  } catch (e) {
    console.warn('audio', e);
  }
}

function prettyExe(exe: string) {
  const map: Record<string, string> = {
    spotify: 'Spotify',
    discord: 'Discord',
    chrome: 'Chrome',
    msedge: 'Edge',
    firefox: 'Firefox',
    brave: 'Brave',
    opera: 'Opera',
    steamwebhelper: 'Steam',
    steam: 'Steam',
    cs2: 'CS2',
    javaw: 'Minecraft (Java)',
    vlc: 'VLC',
  };
  return map[exe.toLowerCase()] ?? exe.charAt(0).toUpperCase() + exe.slice(1);
}

/** "Headphones (JBL Quantum 360 Wireless)" -> "JBL Quantum 360 Wireless" etc. */
function prettyDevice(name: string) {
  const clean = name.replace(/\(R\)|\(TM\)/gi, '').trim();
  const m = clean.match(/^(.*?)\s*\((.+)\)$/);
  if (!m) return clean;
  const [, kind, product] = m;
  return /^(speakers?|headphones?|headset( earphone)?|digital audio.*|realtek.*)$/i.test(kind.trim()) ? product : kind;
}

function useFlashActive() {
  const { flashUntil } = useStore(store);
  const [, rerender] = useState(0);
  useEffect(() => {
    const ms = flashUntil - Date.now();
    if (ms <= 0) return;
    const t = window.setTimeout(() => rerender((x) => x + 1), ms + 20);
    return () => window.clearTimeout(t);
  }, [flashUntil]);
  return Date.now() < flashUntil;
}

/** Speaker icon + level; lights up while you scroll the volume on the bar. */
function Chip({ open }: ChipProps) {
  const { snap } = useStore(store);
  const flashing = useFlashActive();
  const level = snap?.master ?? 0;
  const muted = !!snap?.muted;
  return (
    <span className={`chip vol-chip${open ? ' on' : ''}${flashing ? ' flash' : ''}`}>
      <IconVolume size={14} level={level} muted={muted} />
      {flashing ? (
        <span className="vol-mini">
          <span style={{ width: `${muted ? 0 : level * 100}%` }} />
        </span>
      ) : null}
      <span className="num">{snap ? (muted ? 'Muted' : `${Math.round(level * 100)}%`) : ''}</span>
    </span>
  );
}

function SoundCard({ openSettings }: CardProps) {
  const { snap } = useStore(store);
  const [appsOpen, setAppsOpen] = useState(false);
  const current = snap?.devices.find((d) => d.isDefault);

  return (
    <Card
      icon={<IconVolume size={15} level={snap?.master ?? 1} muted={snap?.muted} />}
      tone="purple"
      title="Sound"
      subtitle={current ? prettyDevice(current.name) : 'Output'}
      value={snap ? (snap.muted ? '–' : Math.round(snap.master * 100)) : undefined}
      unit={snap && !snap.muted ? '%' : undefined}
      action={{ label: 'Sound settings', onClick: () => openTarget('sound') }}
      openSettings={openSettings}
    >
      {!snap ? (
        <div className="panel muted small">Reading audio devices…</div>
      ) : (
        <div className="panel audio">
          <div className="a-row">
            <button className="icon-btn a-mute" onClick={toggleMasterMute} aria-label={snap.muted ? 'Unmute' : 'Mute'}>
              <IconVolume level={snap.master} muted={snap.muted} />
            </button>
            <Slider label="Master volume" value={snap.muted ? 0 : snap.master} onChange={setMaster} />
          </div>

          {snap.devices.length > 1 && (
            <div className="a-devices">
              {snap.devices.map((d) => (
                <button
                  key={d.id}
                  className={`pill-btn${d.isDefault ? ' on' : ''}`}
                  title={d.name}
                  onClick={() => !d.isDefault && setDevice(d.id)}
                >
                  {prettyDevice(d.name)}
                </button>
              ))}
            </div>
          )}

          {snap.apps.length > 0 && (
            <>
              <button className="a-toggle" onClick={() => setAppsOpen((o) => !o)}>
                <span>Apps</span>
                <span className="muted">{snap.apps.length}</span>
                <IconChevron open={appsOpen} />
              </button>
              {appsOpen &&
                snap.apps.map((a) => (
                  <div className="a-row a-app" key={a.pid}>
                    <button
                      className={`icon-btn a-mute${a.muted ? ' off' : ''}`}
                      onClick={() => toggleAppMute(a.pid, !a.muted)}
                      aria-label={`${a.muted ? 'Unmute' : 'Mute'} ${prettyExe(a.exe)}`}
                    >
                      <IconVolume size={14} level={a.volume} muted={a.muted} />
                    </button>
                    <span className={`a-name${a.active ? ' live' : ''}`} title={a.exe}>
                      {prettyExe(a.exe)}
                    </span>
                    <Slider label={`${prettyExe(a.exe)} volume`} value={a.muted ? 0 : a.volume} onChange={(v) => setApp(a.pid, v)} />
                    <span className="a-pct">{a.muted ? '–' : Math.round(a.volume * 100)}</span>
                  </div>
                ))}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export const audioWidget: WidgetDef = {
  id: 'audio',
  title: 'Sound',
  order: 40,
  slot: 'right',
  Chip,
  Card: SoundCard,
  cardWidth: 320,
  onWheel: (deltaY) => {
    onWheel(deltaY);
  },
  poll: {
    interval: ({ visible, openCard, suspended }) => (suspended || !visible ? null : openCard === 'audio' ? 1500 : 5000),
    tick,
  },
};
