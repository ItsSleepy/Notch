import { type ReactNode, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { barPeek, call, inTauri } from '../../core/ipc';
import { createStore, useStore } from '../../core/store';
import { Card } from '../../core/Card';
import { IconClose } from '../../core/icons';
import type { CardProps, ChipProps, WidgetDef } from '../../core/types';

// Phone share: files between this PC and a phone on the same Wi-Fi, through the phone's browser.
// The Rust side runs a small local server (share_core.rs); this is the bar item and card.
// Phone → PC: scan the QR, pick files, they land in Downloads\Notch Share.
// PC → phone: drag files onto the bar (App.tsx opens this card), they show up on the phone page.

interface Offer {
  id: string;
  name: string;
  size: number;
}
interface Received {
  name: string;
  size: number;
  at: number;
}
interface Status {
  enabled: boolean;
  running: boolean;
  url: string | null;
  qrSvg: string | null;
  dir: string;
  offers: Offer[];
  received: Received[];
  error: string | null;
}
type ShareEvent =
  | { kind: 'progress'; id: string; name: string; done: number; total: number }
  | { kind: 'received'; id: string; name: string; size: number }
  | { kind: 'failed'; id: string; name: string; reason: string }
  | { kind: 'sent'; name: string };

interface Live {
  transfer: { id: string; name: string; done: number; total: number } | null;
  flash: { text: string; tone: 'ok' | 'err' } | null;
  dragging: boolean;
}

const status = createStore<Status | null>(null);
const live = createStore<Live>({ transfer: null, flash: null, dragging: false });

async function refresh() {
  const s = await call<Status | undefined>('share_status').catch(() => undefined);
  if (s) status.set(s);
}

let flashTimer: number | undefined;
function flash(text: string, tone: 'ok' | 'err' = 'ok') {
  window.clearTimeout(flashTimer);
  live.set({ ...live.get(), flash: { text, tone } });
  flashTimer = window.setTimeout(() => live.set({ ...live.get(), flash: null }), 4500);
}

if (inTauri) {
  listen<ShareEvent>('share://event', ({ payload: e }) => {
    const l = live.get();
    switch (e.kind) {
      case 'progress':
        live.set({ ...l, transfer: { id: e.id, name: e.name, done: e.done, total: e.total } });
        break;
      case 'received':
        live.set({ ...l, transfer: l.transfer?.id === e.id ? null : l.transfer });
        flash(`Saved ${e.name}`);
        refresh();
        break;
      case 'failed':
        live.set({ ...l, transfer: l.transfer?.id === e.id ? null : l.transfer });
        flash(`${e.name} failed`, 'err');
        break;
      case 'sent':
        flash(`Phone saving ${e.name}`);
        break;
    }
  }).catch(() => {});
}
refresh();

/** Called by App.tsx while files are dragged over the window. */
export function setShareDragging(dragging: boolean) {
  if (live.get().dragging !== dragging) live.set({ ...live.get(), dragging });
}

/** Called by App.tsx when files are dropped anywhere on the bar or a card. */
export async function offerFiles(paths: string[]) {
  const added = await call<number>('share_offer', { paths }).catch(() => 0);
  await refresh();
  if (!added) flash('Only files can be sent, not folders', 'err');
  else if (!status.get()?.enabled) flash('Turn on Phone share to send', 'err');
  else flash(added === 1 ? 'Ready on your phone' : `${added} files ready on your phone`);
}

/** The Windows file picker. The bar hides while it's open, so it peeks back to confirm. */
export async function pickFiles() {
  const added = await call<number>('share_pick').catch(() => 0);
  if (!added) return;
  await refresh();
  if (!status.get()?.enabled) flash('Turn on Phone share to send', 'err');
  else flash(added === 1 ? 'Ready on your phone' : `${added} files ready on your phone`);
  barPeek(3000).catch(() => {});
}

/** Files copied in Explorer (Ctrl+C). */
export async function pasteFiles() {
  const added = await call<number>('share_paste').catch(() => 0);
  if (!added) {
    flash('Nothing copied. Select files in Explorer, Ctrl+C, then Paste', 'err');
    return;
  }
  await refresh();
  if (!status.get()?.enabled) flash('Turn on Phone share to send', 'err');
  else flash(added === 1 ? 'Ready on your phone' : `${added} files ready on your phone`);
}

/** Notch runs as administrator, so Windows blocks drag-and-drop from Explorer. */
let elevated = false;
call<boolean>('share_elevated')
  .then((v) => (elevated = !!v))
  .catch(() => {});

/** A file was let go over the bar but Windows never delivered it. */
export function dropFailed() {
  flash(
    elevated
      ? 'Notch runs as admin, so Windows blocks dropping. Use Paste or Choose files'
      : 'Drop didn\'t go through. Use Paste or Choose files',
    'err',
  );
}

const size = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`;

function ago(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const ext = (n: string) => {
  const i = n.lastIndexOf('.');
  return i > 0 ? n.slice(i + 1, i + 5) : 'file';
};

export const IconShare = ({ size: s = 14 }: { size?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 2.5h8A2.5 2.5 0 0 1 18.5 5v14a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 19V5A2.5 2.5 0 0 1 8 2.5zm0 2a.5.5 0 0 0-.5.5v14a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V5a.5.5 0 0 0-.5-.5h-1.3a.9.9 0 0 1-.9.8h-2.6a.9.9 0 0 1-.9-.8zm4 4.2a.9.9 0 0 1 .64.26l2.3 2.3a.9.9 0 1 1-1.28 1.28l-.76-.76V15a.9.9 0 0 1-1.8 0v-3.22l-.76.76a.9.9 0 1 1-1.28-1.28l2.3-2.3A.9.9 0 0 1 12 8.7z" />
  </svg>
);

const pct = (t: { done: number; total: number }) => (t.total ? Math.min(100, Math.round((t.done / t.total) * 100)) : 0);

function Chip({ open }: ChipProps) {
  const l = useStore(live);
  const s = useStore(status);
  const offers = s?.enabled ? s.offers.length : 0;
  let body: ReactNode = null;
  if (l.dragging) body = <span>Drop to send</span>;
  else if (l.transfer) body = <span className="num">{pct(l.transfer)}%</span>;
  else if (l.flash) body = <span className={l.flash.tone === 'err' ? 'err' : 'share-ok'}>{l.flash.tone === 'ok' ? 'Saved' : 'Failed'}</span>;
  else if (offers) body = <span className="num muted">{offers}</span>;
  const cls = `chip share-chip${open ? ' on' : ''}${body ? '' : ' icon-only'}${l.dragging ? ' dragging' : ''}${s && !s.enabled ? ' off' : ''}`;
  return (
    <span className={cls} title="Phone share">
      <IconShare size={14} />
      {l.transfer && !l.dragging && <span className="share-mini" style={{ width: `${pct(l.transfer)}%` }} />}
      {body}
    </span>
  );
}

function ShareCard({ openSettings }: CardProps) {
  const s = useStore(status);
  const l = useStore(live);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  const toggle = async (on: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      await call('share_enable', { on });
    } catch (e) {
      setErr(String(e));
    }
    await refresh();
    setBusy(false);
  };

  const reset = async () => {
    await call('share_reset').catch(() => {});
    setConfirmReset(false);
    await refresh();
  };

  const open = (what: 'folder' | 'open' | 'reveal', name?: string) =>
    call('share_open', { what, name }).catch((e) => flash(String(e), 'err'));

  const offers = s?.offers ?? [];
  const received = s?.received ?? [];
  const error = err ?? s?.error;

  return (
    <Card
      icon={<IconShare size={15} />}
      tone="green"
      title="Phone share"
      subtitle={!s ? 'Loading…' : !s.enabled ? 'Off' : s.url ? 'On · phone on the same Wi-Fi' : 'On · no network'}
      action={{ label: 'Open folder', onClick: () => open('folder') }}
      openSettings={openSettings}
    >
      {error && <div className="panel err small">{error}</div>}

      {s && !s.enabled && (
        <div className="panel share-off">
          <p>Send photos and files between your phone and this PC. Nothing to install on the phone, it opens in the browser.</p>
          <p className="muted small">Windows will ask once whether Notch can use the network. Allow it on private networks.</p>
          <button className="pill-btn primary" disabled={busy} onClick={() => toggle(true)}>
            Turn on
          </button>
        </div>
      )}

      {s?.enabled && (
        <>
          <div className="panel share-pair">
            {s.qrSvg ? <div className="qr" dangerouslySetInnerHTML={{ __html: s.qrSvg }} /> : <div className="qr empty">No network</div>}
            <div className="share-pair-text">
              <b>Scan with your phone camera</b>
              <span className="muted small">Then add it to your home screen to skip the scan next time.</span>
              {s.url && <span className="muted small share-url">{s.url.replace(/\?t=.*/, '')}</span>}
              {confirmReset ? (
                <span className="share-actions">
                  <button className="pill-btn danger" onClick={reset}>
                    Sign out phones
                  </button>
                  <button className="pill-btn" onClick={() => setConfirmReset(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <span className="share-actions">
                  <button className="pill-btn" onClick={() => setConfirmReset(true)}>
                    New code
                  </button>
                  <button className="pill-btn" disabled={busy} onClick={() => toggle(false)}>
                    Turn off
                  </button>
                </span>
              )}
            </div>
          </div>

          {l.transfer && (
            <div className="panel">
              <div className="kv">
                <span className="share-name">Receiving {l.transfer.name}</span>
                <span className="num">{pct(l.transfer)}%</span>
              </div>
              <div className="share-progress">
                <i style={{ width: `${pct(l.transfer)}%` }} />
              </div>
              <div className="muted small num">
                {size(l.transfer.done)} of {size(l.transfer.total)}
              </div>
            </div>
          )}
        </>
      )}

      <div className={`panel share-drop${l.dragging ? ' over' : ''}`}>
        <div className="sec-label">
          Send to phone
          {offers.length > 1 && (
            <button className="link right" onClick={() => call('share_clear', { what: 'offers' }).then(refresh)}>
              Clear
            </button>
          )}
        </div>
        {offers.length === 0 ? (
          <div className="share-hint">{l.dragging ? 'Drop here to send' : 'Drag files onto the bar, or:'}</div>
        ) : (
          offers.map((o) => (
            <div className="share-row" key={o.id}>
              <span className="share-ico">{ext(o.name)}</span>
              <div className="share-meta">
                <div className="share-name">{o.name}</div>
                <div className="muted small">{size(o.size)} · on the phone page</div>
              </div>
              <button className="round-btn" aria-label="Stop sharing" onClick={() => call('share_unoffer', { id: o.id }).then(refresh)}>
                <IconClose size={10} />
              </button>
            </div>
          ))
        )}
        {!l.dragging && (
          <div className="share-buttons">
            <button className="pill-btn" onClick={pasteFiles} title="Copy files in Explorer (Ctrl+C), then press this">
              Paste copied files
            </button>
            <button className="pill-btn" onClick={pickFiles}>
              Choose files…
            </button>
          </div>
        )}
        {l.flash?.tone === 'err' && <div className="err small share-note">{l.flash.text}</div>}
      </div>

      {received.length > 0 && (
        <div className="panel">
          <div className="sec-label">
            From phone
            <button className="link right" onClick={() => call('share_clear', { what: 'received' }).then(refresh)}>
              Clear
            </button>
          </div>
          {received.slice(0, 6).map((r) => (
            <div className="share-row clickable" key={r.name + r.at} onClick={() => open('open', r.name)} title="Open">
              <span className="share-ico">{ext(r.name)}</span>
              <div className="share-meta">
                <div className="share-name">{r.name}</div>
                <div className="muted small">
                  {size(r.size)} · {ago(r.at)}
                </div>
              </div>
              <button
                className="pill-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  open('reveal', r.name);
                }}
              >
                Show
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export const shareWidget: WidgetDef = {
  id: 'share',
  title: 'Phone share',
  order: 35,
  slot: 'right',
  Chip,
  Card: ShareCard,
  cardWidth: 340,
  poll: {
    // Only refresh while the card is open (the network address can change); events cover the rest.
    interval: ({ openCard, suspended }) => (openCard === 'share' && !suspended ? 5000 : null),
    tick: refresh,
  },
};
