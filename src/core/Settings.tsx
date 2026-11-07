import { useState } from 'react';
import { type Config, type SuspendInfo, setConfig } from './ipc';
import { refreshCalendar } from '../widgets/calendar';

interface Props {
  config: Config;
  suspend: SuspendInfo;
  onSaved: (c: Config) => void;
}

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

const DELAYS = [
  { ms: 0, label: 'Instant' },
  { ms: 150, label: 'Quick' },
  { ms: 250, label: 'Normal' },
  { ms: 500, label: 'Relaxed' },
];

export function Settings({ config, suspend, onSaved }: Props) {
  const [autoHide, setAutoHide] = useState(config.autoHide);
  const [delay, setDelay] = useState(config.revealDelayMs);
  const [hover, setHover] = useState(config.hoverExpand);
  const [h24, setH24] = useState(config.clock24h);
  const [calendars, setCalendars] = useState(config.calendarUrls.join('\n'));
  const [anticheat, setAnticheat] = useState(config.anticheatProcesses.join('\n'));
  const [games, setGames] = useState(config.gameProcesses.join('\n'));
  const [fullscreen, setFullscreen] = useState(config.suspendOnFullscreen);
  const [gameMode, setGameMode] = useState(config.gameMode);
  const [lhm, setLhm] = useState(config.lhmEnabled);
  const [lhmUrl, setLhmUrl] = useState(config.lhmUrl);
  const [status, setStatus] = useState('');

  const save = async () => {
    const next: Config = {
      ...config,
      autoHide,
      revealDelayMs: delay,
      hoverExpand: hover,
      clock24h: h24,
      calendarUrls: lines(calendars),
      anticheatProcesses: lines(anticheat),
      suspendOnFullscreen: fullscreen,
      gameMode,
      gameProcesses: lines(games),
      lhmEnabled: lhm,
      lhmUrl: lhmUrl.trim() || 'http://localhost:8085/data.json',
    };
    try {
      await setConfig(next);
      onSaved(next);
      setStatus('Saved');
      if (next.calendarUrls.join() !== config.calendarUrls.join()) refreshCalendar().catch(() => {});
    } catch (e) {
      setStatus(`Couldn't save: ${String(e)}`);
    }
    window.setTimeout(() => setStatus(''), 2000);
  };

  return (
    <div className="card settings">
      <div className="panel">
        <div className="sec-label">Bar</div>
        <label className="toggle">
          <input type="checkbox" checked={autoHide} onChange={(e) => setAutoHide(e.target.checked)} />
          <span>Hide until the mouse touches the top of the screen</span>
        </label>
        {autoHide && (
          <div className="seg-row">
            <span className="muted small">Appear after</span>
            <div className="seg">
              {DELAYS.map((d) => (
                <button key={d.ms} className={delay === d.ms ? 'on' : ''} onClick={() => setDelay(d.ms)}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="toggle">
          <input type="checkbox" checked={hover} onChange={(e) => setHover(e.target.checked)} />
          <span>Open cards on hover (otherwise click)</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={h24} onChange={(e) => setH24(e.target.checked)} />
          <span>24-hour clock</span>
        </label>
      </div>

      <div className="panel">
        <div className="sec-label">Calendar</div>
        <div className="muted small">
          One link per line. In Google Calendar: Settings › your calendar › <b>Secret address in iCal format</b>. Anyone
          with the link can see that calendar, so keep it private.
        </div>
        <textarea
          value={calendars}
          onChange={(e) => setCalendars(e.target.value)}
          spellCheck={false}
          rows={2}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
        />
      </div>

      <div className="panel">
        <div className="sec-label">Get out of the way</div>
        <label className="toggle">
          <input type="checkbox" checked={fullscreen} onChange={(e) => setFullscreen(e.target.checked)} />
          <span>Pause while a fullscreen app is focused</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={gameMode} onChange={(e) => setGameMode(e.target.checked)} />
          <span>Game mode: slower updates and a longer reveal delay while a game is focused</span>
        </label>
        <div className="s-cols">
          <div>
            <div className="field-label">Full pause while running (anti-cheat / game .exe)</div>
            <textarea value={anticheat} onChange={(e) => setAnticheat(e.target.value)} spellCheck={false} rows={4} />
          </div>
          <div>
            <div className="field-label">Extra games (Steam, Epic, Riot, Xbox, GOG, EA, Ubisoft are automatic)</div>
            <textarea value={games} onChange={(e) => setGames(e.target.value)} spellCheck={false} rows={4} />
          </div>
        </div>
      </div>

      <div className="panel">
        <label className="toggle">
          <input type="checkbox" checked={lhm} onChange={(e) => setLhm(e.target.checked)} />
          <span>CPU temperature from LibreHardwareMonitor</span>
        </label>
        {lhm && (
          <>
            <input className="text" value={lhmUrl} onChange={(e) => setLhmUrl(e.target.value)} spellCheck={false} />
            <div className="muted small">
              In LibreHardwareMonitor: Options › Remote Web Server › Run. Close it before playing games with kernel
              anti-cheat (Vanguard, FACEIT); Notch stops reading it automatically but can't close it for you.
            </div>
          </>
        )}
      </div>

      <div className="card-foot">
        <span className="muted small">
          Fullscreen: {suspend.fullscreen ? 'yes' : 'no'} · Anti-cheat: {suspend.anticheat ? 'detected' : 'none'} · Game:{' '}
          {suspend.game ? 'focused' : 'no'}
        </span>
        <div className="foot-icons">
          <span className="muted small">{status}</span>
          <button className="pill-btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
