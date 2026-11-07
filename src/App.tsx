import { type WheelEvent, useCallback, useEffect, useRef, useState } from 'react';
import { getWidgets } from './core/registry';
import { usePollers } from './core/usePollers';
import { type Config, type SuspendInfo, getConfig, getSuspend, onSuspend, resizeNotch } from './core/ipc';
import { Settings } from './core/Settings';
import { IconBack, IconGear } from './core/icons';

// Logical pixels. The Rust side centres the window at the top of the primary monitor.
const COL_W = 236;
const COL_W_GAME = 120;
const COL_H = 36;
const EXP_W = 540;
const ANIM_MS = 320;

export default function App() {
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [suspend, setSuspend] = useState<SuspendInfo>({
    fullscreen: false,
    anticheat: false,
    userHidden: false,
    game: false,
  });

  const panelsRef = useRef<HTMLDivElement>(null);
  const panelsHeight = useRef(280);
  const expandedRef = useRef(false);
  const pinnedRef = useRef(false);
  const gameRef = useRef(false);
  const timers = useRef<{ enter?: number; leave?: number; shrink?: number }>({});

  const suspended = suspend.fullscreen || suspend.anticheat || suspend.userHidden;
  const game = suspend.game && !suspended;
  gameRef.current = game;
  usePollers({ expanded, suspended, game });

  const pillWidth = () => (gameRef.current ? COL_W_GAME : COL_W);

  const pin = (v: boolean) => {
    pinnedRef.current = v;
    setPinned(v);
  };

  const expand = useCallback(async () => {
    window.clearTimeout(timers.current.shrink);
    // Grow the window first, then let CSS animate the card into the new space.
    await resizeNotch(EXP_W, COL_H + panelsHeight.current).catch(() => {});
    expandedRef.current = true;
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    expandedRef.current = false;
    pin(false);
    setExpanded(false);
    setSettingsOpen(false);
    window.clearTimeout(timers.current.shrink);
    // Shrink the window back to the pill once the animation is done.
    timers.current.shrink = window.setTimeout(() => {
      if (!expandedRef.current) resizeNotch(pillWidth(), COL_H).catch(() => {});
    }, ANIM_MS + 40);
  }, []);

  // Config + suspend state from the backend.
  useEffect(() => {
    getConfig().then(setConfig).catch(() => {});
    getSuspend().then(setSuspend).catch(() => {});
    let unlisten: (() => void) | undefined;
    onSuspend(setSuspend).then((f) => (unlisten = f));
    return () => unlisten?.();
  }, []);

  // Close when suspended, so it comes back as a pill.
  useEffect(() => {
    if (suspended && expandedRef.current) collapse();
  }, [suspended, collapse]);

  // Game focused: close (unless pinned) and shrink to the mini pill. Lost focus: grow back.
  useEffect(() => {
    if (expandedRef.current) {
      if (game && !pinnedRef.current) collapse();
      return;
    }
    if (game) {
      // Let the CSS width animation finish before shrinking the window.
      const t = window.setTimeout(() => resizeNotch(COL_W_GAME, COL_H).catch(() => {}), ANIM_MS);
      return () => window.clearTimeout(t);
    }
    resizeNotch(COL_W, COL_H).catch(() => {});
  }, [game, collapse]);

  // Keep the window height in sync with the panel content.
  useEffect(() => {
    const el = panelsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      panelsHeight.current = el.offsetHeight;
      if (expandedRef.current) resizeNotch(EXP_W, COL_H + el.offsetHeight).catch(() => {});
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onEnter = () => {
    window.clearTimeout(timers.current.leave);
    // No hover-expand in game mode: the top of the screen is too easy to brush past.
    if (!config?.hoverExpand || gameRef.current || expandedRef.current) return;
    window.clearTimeout(timers.current.enter);
    timers.current.enter = window.setTimeout(expand, 140);
  };

  const onLeave = () => {
    window.clearTimeout(timers.current.enter);
    timers.current.leave = window.setTimeout(() => {
      if (expandedRef.current && !pinnedRef.current) collapse();
    }, 350);
  };

  // Click the pill: open and pin. Click again: unpin and close.
  const onHeadClick = () => {
    if (!expandedRef.current) {
      pin(true);
      expand();
    } else if (pinnedRef.current) {
      collapse();
    } else {
      pin(true);
    }
  };

  const widgets = getWidgets();

  // Scrolling over the pill goes to the first widget that wants it (audio: volume).
  const wheelTarget = widgets.find((w) => w.onWheel);
  const onWheel = (e: WheelEvent) => {
    if (e.deltaY !== 0) wheelTarget?.onWheel?.(e.deltaY);
  };

  // Live activities (e.g. volume OSD) take over the pill while active. The widget list is
  // fixed after startup, so the hooks below always run in the same order.
  const activeFlags = widgets.map((w) => (w.activity ? w.activity.useActive() : false));
  const Activity = widgets.find((_, i) => activeFlags[i])?.activity?.Compact;
  const Compact = widgets.find((w) => w.Compact)?.Compact;

  return (
    <div
      className={`notch${expanded ? ' open' : ''}${pinned ? ' pinned' : ''}${game ? ' game' : ''}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="head" onClick={onHeadClick} onWheel={onWheel}>
        <div className="head-main">
          {Activity && !expanded ? <Activity /> : Compact ? <Compact /> : <span className="muted">Notch</span>}
        </div>
        <span className="pin-dot" title={pinned ? 'Pinned open' : ''} />
        <button
          className="icon-btn gear"
          aria-label={settingsOpen ? 'Back' : 'Settings'}
          tabIndex={expanded ? 0 : -1}
          onClick={(e) => {
            e.stopPropagation();
            setSettingsOpen((s) => !s);
          }}
        >
          {settingsOpen ? <IconBack /> : <IconGear />}
        </button>
      </div>

      <div className="body">
        <div className="body-inner">
          <div className="panels" ref={panelsRef}>
            {settingsOpen && config ? (
              <Settings config={config} suspend={suspend} onSaved={setConfig} />
            ) : (
              widgets
                .filter((w) => w.Panel)
                .map((w) => {
                  const Panel = w.Panel!;
                  return (
                    <section key={w.id} className={`card span-${w.span ?? 1}`} data-widget={w.id}>
                      <Panel expanded={expanded} />
                    </section>
                  );
                })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
