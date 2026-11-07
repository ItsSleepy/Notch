import { type ReactNode, useState } from 'react';
import { quitApp } from './ipc';
import { IconGear, IconOpen, IconPower } from './icons';

interface Props {
  /** Coloured tile on the left of the header. */
  icon: ReactNode;
  tone: 'blue' | 'red' | 'orange' | 'green' | 'purple' | 'grey';
  title: ReactNode;
  subtitle?: ReactNode;
  /** Big value on the right of the header (e.g. "18%", "3:57"). */
  value?: ReactNode;
  valueNote?: ReactNode;
  /** Small unit after the big value ("%"). */
  unit?: string;
  children?: ReactNode;
  /** Footer link on the left ("Open Spotify"). */
  action?: { label: string; onClick: () => void };
  openSettings: () => void;
}

/** The frosted card that drops down under a bar item: header, body panels, footer. */
export function Card({ icon, tone, title, subtitle, value, valueNote, unit, children, action, openSettings }: Props) {
  const [confirmQuit, setConfirmQuit] = useState(false);
  return (
    <div className="card">
      <div className="panel card-head">
        <span className={`tile ${tone}`}>{icon}</span>
        <div className="card-titles">
          <div className="card-title">{title}</div>
          {subtitle && <div className="card-sub">{subtitle}</div>}
        </div>
        {value !== undefined && (
          <div className="card-value">
            <div className="big">
              {value}
              {unit && <small>{unit}</small>}
            </div>
            {valueNote && <div className="card-sub right">{valueNote}</div>}
          </div>
        )}
      </div>
      {children}
      <div className="card-foot">
        {action ? (
          <button className="link" onClick={action.onClick}>
            <IconOpen /> {action.label}
          </button>
        ) : (
          <span />
        )}
        <div className="foot-icons">
          {confirmQuit ? (
            <>
              <span className="muted small">Quit Notch?</span>
              <button className="pill-btn danger" onClick={() => quitApp()}>
                Quit
              </button>
              <button className="pill-btn" onClick={() => setConfirmQuit(false)}>
                No
              </button>
            </>
          ) : (
            <>
              <button className="icon-btn" aria-label="Settings" onClick={openSettings}>
                <IconGear size={13} />
              </button>
              <button className="icon-btn" aria-label="Quit Notch" onClick={() => setConfirmQuit(true)}>
                <IconPower />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Small sparkline/area graph. `values` are 0..100. */
export function Spark({ values, width, height, area = false }: { values: number[]; width: number; height: number; area?: boolean }) {
  const n = Math.max(values.length, 2);
  const pts = values.map((v, i) => {
    const x = (i / (n - 1)) * width;
    const y = height - 1 - (Math.min(100, Math.max(0, v)) / 100) * (height - 2);
    return [x, y] as const;
  });
  if (pts.length === 0) return <svg width={width} height={height} />;
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="spark" aria-hidden="true">
      {area && <path d={`${line} L${last[0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`} className="spark-area" />}
      <path d={line} className="spark-line" />
      {area && <circle cx={last[0]} cy={last[1]} r="2.6" className="spark-dot" />}
    </svg>
  );
}
