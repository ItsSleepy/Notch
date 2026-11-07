import { call } from '../../core/ipc';
import { createStore, useStore } from '../../core/store';
import type { CardProps, ChipProps, WidgetDef } from '../../core/types';
import { Card, Spark } from '../../core/Card';
import { IconCpu } from '../../core/icons';
import { openTarget } from '../../core/ipc';

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

/** Latest reading plus the last ~2 minutes of CPU % for the graphs. */
interface SysState {
  stats: SystemStats | null;
  history: number[];
}

const HISTORY = 60;
const store = createStore<SysState>({ stats: null, history: [] });

/** GPU (nvidia-smi) and temperatures are only read while the card is open. */
let full = false;

async function tick() {
  const stats = await call<SystemStats | null>('system_stats', { full });
  if (!stats) return;
  const history = [...store.get().history, stats.cpu].slice(-HISTORY);
  store.set({ stats, history });
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

function cpuTempLabel(s: SystemStats) {
  if (s.cpuTemp !== null) return `${Math.round(s.cpuTemp)}°C`;
  return s.tempSource === 'unreachable' ? 'LHM offline' : null;
}

/** "AMD Ryzen 7 5800X 8-Core Processor" -> "AMD Ryzen 7 5800X" */
const shortCpu = (name: string) => name.replace(/\s+\d+-Core Processor$/i, '').replace(/\(R\)|\(TM\)|CPU @.*$/gi, '').trim();

function Chip({ open }: ChipProps) {
  const { stats, history } = useStore(store);
  return (
    <span className={`chip cpu-chip${open ? ' on' : ''}`}>
      <span className="spark-box">
        <Spark values={history.length > 1 ? history : [0, 0]} width={30} height={12} />
      </span>
      <span className="cpu-label">
        <b>CPU</b>
        <span className="num">{stats ? `${Math.round(stats.cpu)}%` : '–'}</span>
      </span>
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv">
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function CpuCard({ openSettings }: CardProps) {
  const { stats: s, history } = useStore(store);
  const temp = s ? cpuTempLabel(s) : null;
  return (
    <Card
      icon={<IconCpu size={15} />}
      tone="blue"
      title="CPU"
      subtitle={s ? shortCpu(s.cpuName) : 'Reading sensors…'}
      value={s ? Math.round(s.cpu) : '–'}
      unit={s ? '%' : undefined}
      action={{ label: 'Task Manager', onClick: () => openTarget('taskmgr') }}
      openSettings={openSettings}
    >
      <div className="panel graph-panel">
        <Spark values={history.length > 1 ? history : [0, 0]} width={268} height={58} area />
        <div className="graph-legend">
          <span>
            <i className="dot blue" /> Usage <b>{s ? `${Math.round(s.cpu)}%` : '–'}</b>
          </span>
          {temp && (
            <span>
              Temp <b>{temp}</b>
            </span>
          )}
          <span className="muted">2 min</span>
        </div>
      </div>
      {s && (
        <div className="panel">
          <Row label="Memory" value={`${gb(s.ramUsed)} of ${gb(s.ramTotal)} GB`} />
          {s.gpu && (
            <Row
              label="GPU"
              value={`${Math.round(s.gpu.util)}%${s.gpu.temp !== null ? ` · ${Math.round(s.gpu.temp)}°C` : ''} · ${gb(s.gpu.memUsed)}/${gb(s.gpu.memTotal)} GB`}
            />
          )}
          <Row label="Network" value={`↓ ${rate(s.netDown)}  ↑ ${rate(s.netUp)}`} />
          <Row label={`Disk ${s.diskName}`} value={`${gb(s.diskUsed)} of ${gb(s.diskTotal)} GB`} />
          <Row label="Up for" value={uptime(s.uptimeSecs)} />
        </div>
      )}
    </Card>
  );
}

export const systemWidget: WidgetDef = {
  id: 'system',
  title: 'CPU',
  order: 30,
  slot: 'right',
  Chip,
  Card: CpuCard,
  cardWidth: 300,
  poll: {
    // Only while the bar is on screen.
    interval: ({ visible, openCard, suspended, game }) => {
      full = openCard === 'system';
      return suspended || !visible ? null : full ? 1500 : game ? 4000 : 2000;
    },
    tick,
  },
};
