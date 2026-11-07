import { call } from '../../core/ipc';
import { createStore, useStore } from '../../core/store';
import type { WidgetDef } from '../../core/types';

interface GpuStats {
  name: string;
  util: number;
  temp: number | null;
  memUsed: number;
  memTotal: number;
}

interface SystemStats {
  cpu: number;
  cpuName: string;
  cpuTemp: number | null;
  tempSource: 'lhm' | 'off' | 'unreachable';
  ramUsed: number;
  ramTotal: number;
  diskName: string;
  diskUsed: number;
  diskTotal: number;
  netDown: number;
  netUp: number;
  uptimeSecs: number;
  gpu: GpuStats | null;
}

const store = createStore<SystemStats | null>(null);

async function tick() {
  const stats = await call<SystemStats | null>('system_stats');
  if (stats) store.set(stats);
}

const GB = 1024 ** 3;
const gb = (b: number) => (b / GB).toFixed(b / GB >= 100 ? 0 : 1);

function rate(bps: number) {
  if (bps >= 1024 ** 2) return `${(bps / 1024 ** 2).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

function uptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

function tone(pct: number) {
  if (pct >= 90) return 'var(--hot)';
  if (pct >= 70) return 'var(--warm)';
  return 'var(--cool)';
}

function cpuTempLabel(s: SystemStats) {
  if (s.cpuTemp !== null) return `${Math.round(s.cpuTemp)}°C`;
  return s.tempSource === 'unreachable' ? 'LHM offline' : 'temp off';
}

function Ring({ label, pct, detail }: { label: string; pct: number | null; detail: string }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const v = pct === null ? 0 : Math.min(100, Math.max(0, pct));
  return (
    <div className="ring">
      <svg width="62" height="62" viewBox="0 0 62 62">
        <circle cx="31" cy="31" r={r} className="ring-track" />
        <circle
          cx="31"
          cy="31"
          r={r}
          className="ring-value"
          stroke={tone(v)}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          transform="rotate(-90 31 31)"
        />
        <text x="31" y="35" textAnchor="middle" className="ring-text">
          {pct === null ? '–' : `${Math.round(v)}%`}
        </text>
      </svg>
      <div className="ring-label">{label}</div>
      <div className="ring-detail">{detail}</div>
    </div>
  );
}

function Panel() {
  const s = useStore(store);
  if (!s) return <div className="muted small pad">Reading sensors…</div>;

  const ramPct = (s.ramUsed / s.ramTotal) * 100;
  const diskPct = s.diskTotal > 0 ? (s.diskUsed / s.diskTotal) * 100 : 0;
  const gpu = s.gpu;

  return (
    <div className="system">
      <div className="rings">
        <Ring label="CPU" pct={s.cpu} detail={cpuTempLabel(s)} />
        <Ring label="RAM" pct={ramPct} detail={`${gb(s.ramUsed)} / ${gb(s.ramTotal)} GB`} />
        <Ring
          label="GPU"
          pct={gpu ? gpu.util : null}
          detail={gpu ? `${gpu.temp !== null ? `${Math.round(gpu.temp)}°C · ` : ''}${gb(gpu.memUsed)}/${gb(gpu.memTotal)} GB` : 'not detected'}
        />
      </div>
      <div className="stats">
        <div className="stat">
          <span className="muted">Disk {s.diskName}</span>
          <div className="bar">
            <div style={{ width: `${diskPct}%`, background: tone(diskPct) }} />
          </div>
          <span>
            {gb(s.diskUsed)} / {gb(s.diskTotal)} GB
          </span>
        </div>
        <div className="stat">
          <span className="muted">Network</span>
          <span>
            ↓ {rate(s.netDown)} &nbsp; ↑ {rate(s.netUp)}
          </span>
        </div>
        <div className="stat">
          <span className="muted">Uptime</span>
          <span>{uptime(s.uptimeSecs)}</span>
        </div>
        <div className="stat cpu-name muted" title={gpu ? `${s.cpuName} · ${gpu.name}` : s.cpuName}>
          {s.cpuName}
          {gpu ? ` · ${gpu.name}` : ''}
        </div>
      </div>
    </div>
  );
}

export const systemWidget: WidgetDef = {
  id: 'system',
  title: 'System',
  order: 20,
  span: 2,
  Panel,
  poll: {
    // Only poll while the notch is open.
    interval: ({ expanded, suspended }) => (expanded && !suspended ? 2000 : null),
    tick,
  },
};
