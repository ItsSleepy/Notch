import { type CSSProperties, type MouseEvent, useEffect, useState } from 'react';
import { call } from '../../core/ipc';
import { createStore, useStore } from '../../core/store';
import type { PanelProps, WidgetDef } from '../../core/types';
import { IconMusic, IconNext, IconPause, IconPlay, IconPrev } from '../../core/icons';
import { DEFAULT_ACCENT, extractAccent } from './accent';

// Reads the Windows media session (SMTC): works with Spotify and any other player, no login.

interface MediaInfo {
  title: string;
  artist: string;
  album: string;
  source: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  trackKey: string;
  /** Only sent when the track changed (data: URL). */
  art: string | null;
}

interface MediaState {
  info: MediaInfo | null;
  art: string | null;
  accent: string;
  fetchedAt: number;
}

const empty: MediaState = { info: null, art: null, accent: DEFAULT_ACCENT, fetchedAt: 0 };
const store = createStore<MediaState>(empty);

async function tick() {
  const cur = store.get();
  // Tell the backend which track we already have art for, so it only sends art on change.
  const knownKey = cur.art && cur.info ? cur.info.trackKey : '';
  const info = await call<MediaInfo | null>('media_get', { knownKey });
  const fetchedAt = Date.now();

  if (!info) {
    store.set({ ...empty, fetchedAt });
    return;
  }

  let { art, accent } = cur;
  if (info.art) {
    art = info.art;
    accent = await extractAccent(info.art);
  } else if (!cur.info || cur.info.trackKey !== info.trackKey) {
    art = null;
    accent = DEFAULT_ACCENT;
  }
  store.set({ info, art, accent, fetchedAt });
}

async function control(action: 'playPause' | 'next' | 'previous' | 'seek', valueMs?: number) {
  const cur = store.get();
  // Optimistic update so the button feels instant.
  if (cur.info && action === 'playPause') {
    store.set({ ...cur, info: { ...cur.info, playing: !cur.info.playing, positionMs: livePosition(cur, Date.now()) }, fetchedAt: Date.now() });
  }
  if (cur.info && action === 'seek' && valueMs !== undefined) {
    store.set({ ...cur, info: { ...cur.info, positionMs: valueMs }, fetchedAt: Date.now() });
  }
  try {
    await call('media_control', { action, valueMs: valueMs ?? null });
  } catch (e) {
    console.warn('media control failed', e);
  }
  window.setTimeout(() => tick().catch(() => {}), 350);
}

function livePosition(s: MediaState, now: number) {
  if (!s.info) return 0;
  const elapsed = s.info.playing ? Math.max(0, now - s.fetchedAt) : 0;
  const pos = s.info.positionMs + elapsed;
  return s.info.durationMs > 0 ? Math.min(pos, s.info.durationMs) : pos;
}

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function prettySource(id: string) {
  const s = id.toLowerCase();
  if (s.includes('spotify')) return 'Spotify';
  if (s.includes('chrome')) return 'Chrome';
  if (s.includes('msedge')) return 'Edge';
  if (s.includes('firefox')) return 'Firefox';
  if (s.includes('brave')) return 'Brave';
  if (s.includes('opera')) return 'Opera';
  if (s.includes('vlc')) return 'VLC';
  return id.replace(/\.exe$/i, '').split(/[\\!]/).pop() || 'Media';
}

const accentStyle = (accent: string) => ({ '--accent': accent }) as CSSProperties;

function Compact() {
  const s = useStore(store);
  if (!s.info) {
    return (
      <div className="m-compact idle">
        <span className="m-thumb empty">
          <IconMusic size={12} />
        </span>
        <span className="m-ctitle muted">Nothing playing</span>
      </div>
    );
  }
  return (
    <div className="m-compact" style={accentStyle(s.accent)}>
      <span className="m-thumb" style={s.art ? { backgroundImage: `url("${s.art}")` } : undefined}>
        {!s.art && <IconMusic size={12} />}
      </span>
      <span className={`m-ctitle${s.info.playing ? '' : ' paused'}`}>
        {s.info.title}
        {s.info.artist && <span className="muted"> · {s.info.artist}</span>}
      </span>
      <span className={`eq${s.info.playing ? ' on' : ''}`}>
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

function Panel({ expanded }: PanelProps) {
  const s = useStore(store);
  const [now, setNow] = useState(Date.now());
  const playing = !!s.info?.playing;

  // Smooth progress between polls, only while visible and playing.
  useEffect(() => {
    if (!expanded || !playing) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [expanded, playing]);

  const info = s.info;
  const pos = livePosition(s, Math.max(now, s.fetchedAt));
  const dur = info?.durationMs ?? 0;
  const pct = dur > 0 ? (pos / dur) * 100 : 0;

  const seek = (e: MouseEvent<HTMLDivElement>) => {
    if (!info || dur <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    control('seek', Math.round(ratio * dur));
  };

  return (
    <div className="media" style={accentStyle(s.accent)}>
      <div className="m-art" style={s.art ? { backgroundImage: `url("${s.art}")` } : undefined}>
        {!s.art && <IconMusic size={30} />}
      </div>
      <div className="m-meta">
        <div className="m-source">{info ? prettySource(info.source) : 'Media'}</div>
        <div className="m-title" title={info?.title}>
          {info?.title || 'Nothing playing'}
        </div>
        <div className="m-artist" title={info?.artist}>
          {info ? info.artist || info.album : 'Start something in Spotify'}
        </div>

        <div className={`m-progress${dur > 0 ? '' : ' disabled'}`} onClick={seek}>
          <div className="m-bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="m-times">
          <span>{fmt(pos)}</span>
          <span>{dur > 0 ? fmt(dur) : '--:--'}</span>
        </div>

        <div className="m-controls">
          <button className="icon-btn" disabled={!info} onClick={() => control('previous')} aria-label="Previous">
            <IconPrev />
          </button>
          <button className="icon-btn play" disabled={!info} onClick={() => control('playPause')} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button className="icon-btn" disabled={!info} onClick={() => control('next')} aria-label="Next">
            <IconNext />
          </button>
        </div>
      </div>
    </div>
  );
}

export const mediaWidget: WidgetDef = {
  id: 'media',
  title: 'Now playing',
  order: 10,
  span: 2,
  Compact,
  Panel,
  poll: {
    // Collapsed pill still shows the track, just refreshed less often.
    interval: ({ expanded, suspended, game }) => (suspended ? null : expanded ? 1500 : game ? 5000 : 3000),
    tick,
  },
  onSuspend: () => store.set(empty),
};
