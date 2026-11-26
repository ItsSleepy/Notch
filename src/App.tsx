import { type ReactNode, type WheelEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getWidgets } from './core/registry';
import { usePollers } from './core/usePollers';
import {
  BAR_H,
  type Config,
  type SuspendInfo,
  barDismiss,
  barResize,
  barSetHold,
  barVisible,
  configStore,
  getConfig,
  getSuspend,
  inTauri,
  onBarVisibility,
  onSuspend,
} from './core/ipc';
import { Settings } from './core/Settings';
import { IconGear } from './core/icons';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen } from '@tauri-apps/api/event';
import { dropFailed, offerFiles, setShareDragging } from './widgets/share';

const CARD_GAP = 6; // space between the bar and a card
const CARD_SHADOW = 30; // room under a card for its shadow
const ANIM_MS = 180;
const SETTINGS_W = 520;

export default function App() {
  const [visible, setVisible] = useState(!inTauri);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [cardLeft, setCardLeft] = useState(0);
  const [config, setConfigState] = useState<Config | null>(null);
  const [suspend, setSuspend] = useState<SuspendInfo>({ fullscreen: false, anticheat: false, userHidden: false, game: false });

  const chipRefs = useRef<Record<string, HTMLElement | null>>({});
  const cardRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<string | null>(null);
  const pinnedRef = useRef(false);
  const timers = useRef<{ open?: number; close?: number; shrink?: number }>({});

  const suspended = suspend.fullscreen || suspend.anticheat || suspend.userHidden;
  const game = suspend.game && !suspended;
  usePollers({ visible, openCard: openId, suspended, game });

  const widgets = getWidgets();
  const widgetById = (id: string) => widgets.find((w) => w.id === id);
  const cardWidth = (id: string) => (id === 'settings' ? SETTINGS_W : widgetById(id)?.cardWidth ?? 300);

  const clearTimers = () => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
  };

  const close = useCallback(() => {
    clearTimers();
    if (!openRef.current) return;
    openRef.current = null;
    pinnedRef.current = false;
    setOpenId(null);
    setPinned(false);
    barSetHold(false).catch(() => {});
    window.clearTimeout(timers.current.shrink);
    timers.current.shrink = window.setTimeout(() => {
      if (!openRef.current) barResize(BAR_H).catch(() => {});
    }, ANIM_MS + 20);
  }, []);

  const open = useCallback((id: string, pin: boolean) => {
    clearTimers();
    window.clearTimeout(timers.current.shrink);
    const chip = chipRefs.current[id];
    const w = cardWidth(id);
    const maxLeft = window.innerWidth - w - 8;
    const center = chip ? chip.getBoundingClientRect().left + chip.offsetWidth / 2 : window.innerWidth - w / 2;
    setCardLeft(Math.max(8, Math.min(maxLeft, center - w / 2)));
    openRef.current = id;
    pinnedRef.current = pin;
    setOpenId(id);
    setPinned(pin);
    barSetHold(pin).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Config + suspend state + bar visibility from the backend.
  useEffect(() => {
    getConfig()
      .then((c) => {
        setConfigState(c);
        configStore.set(c);
      })
      .catch(() => {});
    getSuspend().then(setSuspend).catch(() => {});
    barVisible().then((v) => inTauri && setVisible(v)).catch(() => {});
    const offs: Array<() => void> = [];
    onSuspend(setSuspend).then((f) => offs.push(f));
    onBarVisibility(({ visible: v }) => {
      setVisible(v);
      if (!v) close();
    }).then((f) => offs.push(f));
    return () => offs.forEach((f) => f());
  }, [close]);

  // Dragging files to the top of the screen opens Phone share; dropping them offers them to the
  // phone. Notch spots the drag itself (bar://drag: mouse held since outside the bar, now at the
  // top edge) because a drag doesn't deliver hover events. The card is unpinned after, so the bar
  // hides once the mouse moves away (a drop doesn't give the window focus).
  useEffect(() => {
    if (!inTauri) return;
    const offs: Array<() => void> = [];
    let alive = true;
    let unpin: number | undefined;
    let dropSeen = false;
    let native = false; // a drag Notch itself spotted (ends with bar://drag-end)
    const keep = (f: () => void) => (alive ? offs.push(f) : f());
    const unpinSoon = (ms: number) => {
      window.clearTimeout(unpin);
      unpin = window.setTimeout(() => {
        if (openRef.current !== 'share' || !pinnedRef.current) return;
        pinnedRef.current = false;
        setPinned(false);
        barSetHold(false).catch(() => {});
      }, ms);
    };
    const startDrag = () => {
      window.clearTimeout(unpin);
      dropSeen = false;
      setShareDragging(true);
      if (openRef.current !== 'share' || !pinnedRef.current) open('share', true);
    };
    listen('bar://drag', () => {
      native = true;
      startDrag();
    })
      .then(keep)
      .catch(() => {});
    listen<boolean>('bar://drag-end', ({ payload: over }) => {
      // Give the drop event a moment to arrive before deciding it never will.
      native = false;
      window.setTimeout(() => {
        setShareDragging(false);
        if (over && !dropSeen) dropFailed();
        unpinSoon(over ? 2500 : 500);
      }, 600);
    })
      .then(keep)
      .catch(() => {});
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === 'enter') startDrag();
        else if (payload.type === 'drop') {
          dropSeen = true;
          setShareDragging(false);
          if (payload.paths.length) offerFiles(payload.paths);
          unpinSoon(2500);
        } else if (payload.type === 'leave' && !native) {
          setShareDragging(false);
          unpinSoon(600);
        }
      })
      .then(keep)
      .catch(() => {});
    return () => {
      alive = false;
      window.clearTimeout(unpin);
      offs.forEach((f) => f());
    };
  }, [open]);

  // Clicking into another app closes a pinned card.
  useEffect(() => {
    const onBlur = () => close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openRef.current) close();
      else barDismiss().catch(() => {});
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);

  useEffect(() => {
    if (suspended) close();
  }, [suspended, close]);

  // Grow the window to fit the open card; it shrinks back in close().
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!openId || !el) return;
    const fit = () => barResize(BAR_H + CARD_GAP + el.offsetHeight + CARD_SHADOW).catch(() => {});
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [openId]);

  const hoverOpens = config?.hoverExpand ?? true;

  const onChipEnter = (id: string, hasCard: boolean) => {
    window.clearTimeout(timers.current.close);
    if (!hasCard) return;
    if (openRef.current) {
      // Sliding along the bar switches cards straight away (unless one was clicked open).
      if (openRef.current !== id && !pinnedRef.current) open(id, false);
      return;
    }
    if (!hoverOpens) return;
    window.clearTimeout(timers.current.open);
    timers.current.open = window.setTimeout(() => open(id, false), 140);
  };

  const scheduleClose = () => {
    window.clearTimeout(timers.current.open);
    if (!openRef.current || pinnedRef.current) return;
    window.clearTimeout(timers.current.close);
    timers.current.close = window.setTimeout(close, 300);
  };

  const onChipClick = (id: string, hasCard: boolean) => {
    if (!hasCard) return;
    if (openRef.current === id && pinnedRef.current) close();
    else open(id, true);
  };

  // Scrolling anywhere on the bar goes to the first widget that wants it (audio: volume).
  const wheelTarget = widgets.find((w) => w.onWheel);
  const onWheel = (e: WheelEvent) => {
    if (e.deltaY !== 0) wheelTarget?.onWheel?.(e.deltaY);
  };

  const chip = (id: string, hasCard: boolean, children: ReactNode, extra = '') => (
    <div
      key={id}
      ref={(el) => (chipRefs.current[id] = el)}
      className={`chip-wrap${openId === id ? ' open' : ''}${hasCard ? ' has-card' : ''}${extra}`}
      onMouseEnter={() => onChipEnter(id, hasCard)}
      onMouseLeave={scheduleClose}
      onClick={() => onChipClick(id, hasCard)}
    >
      {children}
    </div>
  );

  const slot = (name: 'left' | 'center' | 'right') =>
    widgets
      .filter((w) => w.slot === name)
      .map((w) => chip(w.id, !!w.Card, <w.Chip open={openId === w.id} />));

  const openWidget = openId && openId !== 'settings' ? widgetById(openId) : undefined;
  const OpenCard = openWidget?.Card;

  return (
    <div
      className={`root${visible ? ' shown' : ''}`}
      onMouseDown={(e) => {
        // A click on the empty, see-through part of the window closes the card.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className={`bar${game ? ' game' : ''}`} onWheel={onWheel}>
        <div className="slot left">{slot('left')}</div>
        <div className="slot center">{slot('center')}</div>
        <div className="slot right">
          {slot('right')}
          {chip(
            'settings',
            true,
            <span className="chip icon-only" aria-label="Settings">
              <IconGear size={13} />
            </span>,
          )}
        </div>
      </div>

      {openId && (
        <div
          ref={cardRef}
          className={`card-wrap${pinned ? ' pinned' : ''}`}
          style={{ left: cardLeft, top: BAR_H + CARD_GAP, width: cardWidth(openId) }}
          onMouseEnter={() => window.clearTimeout(timers.current.close)}
          onMouseLeave={scheduleClose}
          onMouseDown={() => {
            // Interacting with a hover-opened card pins it, so it doesn't vanish mid-drag.
            if (!pinnedRef.current) {
              pinnedRef.current = true;
              setPinned(true);
              barSetHold(true).catch(() => {});
            }
          }}
        >
          {openId === 'settings' ? (
            config && (
              <Settings
                config={config}
                suspend={suspend}
                onSaved={(c) => {
                  setConfigState(c);
                  configStore.set(c);
                }}
              />
            )
          ) : OpenCard ? (
            <OpenCard close={close} openSettings={() => open('settings', true)} />
          ) : null}
        </div>
      )}
    </div>
  );
}
