import { useState } from 'react';
import { type Config, type SuspendInfo, setConfig } from './ipc';

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

export function Settings({ config, suspend, onSaved }: Props) {
  const [anticheat, setAnticheat] = useState(config.anticheatProcesses.join('\n'));
  const [games, setGames] = useState(config.gameProcesses.join('\n'));
  const [fullscreen, setFullscreen] = useState(config.suspendOnFullscreen);
  const [hover, setHover] = useState(config.hoverExpand);
  const [gameMode, setGameMode] = useState(config.gameMode);
  const [lhm, setLhm] = useState(config.lhmEnabled);
  const [lhmUrl, setLhmUrl] = useState(config.lhmUrl);
  const [status, setStatus] = useState('');

  const save = async () => {
    const next: Config = {
      anticheatProcesses: lines(anticheat),
      suspendOnFullscreen: fullscreen,
      hoverExpand: hover,
      gameMode,
      gameProcesses: lines(games),
      lhmEnabled: lhm,
      lhmUrl: lhmUrl.trim() || 'http://localhost:8085/data.json',
    };
    try {
      await setConfig(next);
      onSaved(next);
      setStatus('Saved');
    } catch (e) {
      setStatus(`Couldn't save: ${String(e)}`);
    }
    window.setTimeout(() => setStatus(''), 2000);
  };

  return (
    <section className="card span-2 settings">
      <div className="card-title">Settings</div>

      <div className="s-group">
        <label className="toggle">
          <input type="checkbox" checked={hover} onChange={(e) => setHover(e.target.checked)} />
          <span>Expand on hover (otherwise click the pill)</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={fullscreen} onChange={(e) => setFullscreen(e.target.checked)} />
          <span>Hide and pause while a fullscreen app is focused</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={gameMode} onChange={(e) => setGameMode(e.target.checked)} />
          <span>Game mode: mini pill and no hover-expand while a game is focused</span>
        </label>
      </div>

      <div className="s-cols">
        <div>
          <div className="field-label">Full suspend when running (anti-cheat / game .exe)</div>
          <textarea value={anticheat} onChange={(e) => setAnticheat(e.target.value)} spellCheck={false} rows={5} />
        </div>
        <div>
          <div className="field-label">Extra games (Steam, Epic, Riot, Xbox, GOG, EA, Ubisoft are automatic)</div>
          <textarea value={games} onChange={(e) => setGames(e.target.value)} spellCheck={false} rows={5} />
        </div>
      </div>

      <div className="s-group">
        <label className="toggle">
          <input type="checkbox" checked={lhm} onChange={(e) => setLhm(e.target.checked)} />
          <span>CPU temperature from LibreHardwareMonitor</span>
        </label>
        {lhm && (
          <>
            <input className="text" value={lhmUrl} onChange={(e) => setLhmUrl(e.target.value)} spellCheck={false} />
            <div className="muted small">
              In LibreHardwareMonitor: Options › Remote Web Server › Run. Close it before playing games with
              kernel anti-cheat (Vanguard, FACEIT); Notch stops reading it automatically but can't close it for you.
            </div>
          </>
        )}
      </div>

      <div className="settings-foot">
        <span className="muted small">
          Fullscreen: {suspend.fullscreen ? 'yes' : 'no'} · Anti-cheat: {suspend.anticheat ? 'detected' : 'none'} · Game:{' '}
          {suspend.game ? 'focused' : 'no'}
        </span>
        <span className="muted small">{status}</span>
        <button className="btn" onClick={save}>
          Save
        </button>
      </div>
    </section>
  );
}
