// Fake backend used only when the UI runs in a normal browser (npm run dev).

const art =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5f6d"/><stop offset="1" stop-color="#7b2ff7"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><circle cx="60" cy="60" r="26" fill="#111"/></svg>`,
  );

let playing = true;
let position = 74_000;
let last = Date.now();
let config = {
  anticheatProcesses: ['EasyAntiCheat.exe', 'BEService.exe', 'VALORANT-Win64-Shipping.exe'],
  suspendOnFullscreen: true,
  hoverExpand: true,
  autoHide: true,
  revealDelayMs: 250,
  calendarUrls: ['https://calendar.google.com/calendar/ical/example/basic.ics'],
  clock24h: true,
  gameMode: true,
  gameProcesses: ['javaw.exe', 'Minecraft.Windows.exe'],
  lhmEnabled: false,
  lhmUrl: 'http://localhost:8085/data.json',
};

const audio = {
  master: 0.42,
  muted: false,
  devices: [
    { id: 'a', name: 'Headphones (JBL Quantum 360 Wireless)', isDefault: true },
    { id: 'b', name: 'Speakers (Realtek(R) Audio)', isDefault: false },
    { id: 'c', name: 'GS32QA (NVIDIA High Definition Audio)', isDefault: false },
  ],
  apps: [
    { pid: 11, exe: 'Spotify', volume: 0.8, muted: false, active: true },
    { pid: 12, exe: 'Discord', volume: 0.65, muted: false, active: true },
    { pid: 13, exe: 'chrome', volume: 1, muted: true, active: false },
    { pid: 0, exe: 'System sounds', volume: 0.5, muted: false, active: false },
  ],
};

/** Events don't exist outside Tauri; the sandbox just never fires them. */
export async function mockListen(_event: string, _cb: (payload: unknown) => void): Promise<() => void> {
  return () => {};
}

function mockCalendar() {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const at = (d: number, h: number, m = 0) => day.getTime() + d * 86400000 + (h * 60 + m) * 60000;
  const now = Date.now();
  const soon = Math.ceil((now + 9 * 60000) / 60000) * 60000;
  return {
    configured: true,
    error: null,
    fetchedAt: now,
    events: [
      { title: 'Release day', start: at(0, 0), end: at(1, 0), allDay: true, location: '', cal: 0 },
      { title: 'Design review', start: soon, end: soon + 40 * 60000, allDay: false, location: '', cal: 1 },
      { title: 'Lunch with Sam', start: soon + 3 * 3600000, end: soon + 4 * 3600000, allDay: false, location: '', cal: 2 },
      { title: 'Yoga', start: at(1, 8), end: at(1, 9), allDay: false, location: '', cal: 1 },
    ],
  };
}

export async function mockCall<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const now = Date.now();
  if (playing) position += now - last;
  last = now;
  const r = (v: unknown) => v as T;

  switch (cmd) {
    case 'media_get': {
      const key = 'Midnight Drive|Neon Coast|Afterglow';
      return r({
        title: 'Midnight Drive',
        artist: 'Neon Coast',
        album: 'Afterglow',
        source: 'Spotify.exe',
        playing,
        positionMs: position % 214_000,
        durationMs: 214_000,
        trackKey: key,
        art: args?.knownKey === key ? null : art,
      });
    }
    case 'media_control':
      if (args?.action === 'playPause') playing = !playing;
      if (args?.action === 'seek') position = Number(args.valueMs ?? 0);
      return r(undefined);
    case 'system_stats':
      return r({
        cpu: 18 + Math.random() * 20,
        cpuName: 'AMD Ryzen 7 5800X',
        cpuTemp: 47 + Math.random() * 6,
        tempSource: 'lhm',
        ramUsed: 13.4 * 1024 ** 3,
        ramTotal: 31.9 * 1024 ** 3,
        diskUsed: 612 * 1024 ** 3,
        diskTotal: 931 * 1024 ** 3,
        diskName: 'C:',
        netDown: Math.random() * 3_000_000,
        netUp: Math.random() * 200_000,
        uptimeSecs: 3 * 86400 + 4 * 3600 + 120,
        gpu: {
          name: 'NVIDIA GeForce RTX 3070',
          util: 30 + Math.random() * 30,
          temp: 58,
          memUsed: 3.1 * 1024 ** 3,
          memTotal: 8 * 1024 ** 3,
        },
      });
    case 'get_config':
      return r(config);
    case 'set_config':
      config = args?.config as typeof config;
      return r(undefined);
    case 'calendar_events':
      return r(mockCalendar());
    case 'bar_visible':
      return r(true);
    case 'get_suspend':
      return r({ fullscreen: false, anticheat: false, userHidden: false, game: false });
    case 'audio_snapshot':
      return r(structuredClone(audio));
    case 'audio_set_master':
      audio.master = Number(args?.volume);
      return r(undefined);
    case 'audio_nudge_master':
      audio.master = Math.min(1, Math.max(0, audio.master + Number(args?.delta)));
      audio.muted = false;
      return r(audio.master);
    case 'audio_set_master_mute':
      audio.muted = Boolean(args?.muted);
      return r(undefined);
    case 'audio_set_app': {
      const app = audio.apps.find((a) => a.pid === args?.pid);
      if (app && args?.volume != null) app.volume = Number(args.volume);
      if (app && args?.muted != null) app.muted = Boolean(args.muted);
      return r(undefined);
    }
    case 'audio_set_device':
      audio.devices.forEach((d) => (d.isDefault = d.id === args?.id));
      return r(undefined);
    default:
      return r(undefined);
  }
}
