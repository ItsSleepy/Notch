# Notch

An auto-hiding top bar for Windows 11, macOS-menu-bar style. Tauri 2 (Rust) + React/Vite.

The bar stays hidden until you push the mouse against the very top edge of the screen, so it never
covers browser tabs. It slides down, and hides again shortly after the mouse leaves it.

Bar items (hover to open a card, click to keep it open):

- **Calendar** (left): your next event today, or the date. Card: today's events, what's next.
  Reads Google Calendar (or any iCal feed) from the links in settings.
- **Music** (centre): what Spotify (or any player) is playing. Card: art, seekable progress, controls.
- **Timers**: the soonest running timer. Card: several named timers, pause / +1 min / remove, quick 1/5/10/25 min.
  When one finishes the bar pops down, chimes, and the item flashes.
- **CPU**: live mini graph + %. Card: 2-minute graph, memory, GPU, network, disk, uptime.
- **Sound**: volume. Card: master volume, output device switch, per-app mixer. Scroll anywhere on the bar to change the volume.
- **Clock**, and the gear for settings.

Light or dark follows your Windows app theme. Pauses for fullscreen apps and anti-cheat games, as before.

## One-time setup

1. **Rust:** install from https://rustup.rs (default options).
2. **C++ build tools:** install *Visual Studio Build Tools* and tick **Desktop development with C++**.
3. Node.js (you have it). WebView2 already ships with Windows 11.

## Run

```powershell
cd C:\Users\User\Downloads\Notch
npm install
npm run tauri dev      # first run compiles Rust deps, takes a few minutes
```

Build an installer: `npm run tauri build` → `src-tauri\target\release\bundle\nsis\`.

UI-only sandbox with fake data (no Rust needed): `npm run dev` and open http://localhost:1420.

## Using it

- Push the mouse to the top edge of the screen to show the bar. Escape hides it.
- Hover an item to open its card; click it to keep the card open until you click elsewhere.
- Scroll over the bar to change the volume.
- Gear (right end of the bar) → settings: auto-hide on/off and how quickly it appears, hover vs click, 24-hour clock, calendar links.
- Tray icon → *Show the bar*, *Pause / resume Notch*, *Quit*.
- Settings are saved to `%APPDATA%\eu.isaac-dev.notch\config.json`.

## Suspend rules

| Trigger | What happens |
|---|---|
| A fullscreen app is focused (exclusive, or borderless covering the whole monitor) | The bar won't appear, all polling stops. Maximised windows don't count. |
| Any listed process is running (anti-cheat services / game exes) | Full suspend: hidden, no polling, no sensor access. |
| Hidden from the tray | Same as above until you show it again. |
| A game is focused but not fullscreen (game mode) | Slower polling and a longer reveal delay, so flicking the mouse up doesn't pop the bar open. Games in Steam/Epic/Riot/Xbox/GOG/EA/Ubisoft folders are detected automatically; add others (e.g. `javaw.exe`) in settings. |

Riot Vanguard's `vgc.exe` runs permanently once installed, so the default list matches the Riot game exes instead. Add any game exe you want covered in settings.

## Adding a widget

1. Create `src/widgets/<name>/index.tsx` exporting a `WidgetDef` (see `src/core/types.ts`): a `slot`
   (left / center / right), a `Chip` for the bar and optionally a `Card` (use `core/Card.tsx` for the look).
2. Register it in `src/widgets/index.ts`.
3. If it needs native data, add a Rust command in `src-tauri/src/commands.rs` and list it in `lib.rs`.

The shell handles polling: your `poll.interval()` gets `{ visible, openCard, suspended, game }` and returns
milliseconds, or `null` to pause. Nothing should poll while the bar is hidden.

## Project layout

```
src/
  App.tsx              bar shell: chips, hover/click cards, window sizing, slide animation
  core/                registry, poll scheduler, store, IPC (+ browser mocks), Card, settings
  widgets/calendar/    next event chip, today's events card
  widgets/media/       now playing chip and card, album-art accent colour
  widgets/timers/      named countdown timers (kept in localStorage)
  widgets/system/      CPU graph chip, CPU/memory/GPU/network card
  widgets/audio/       volume chip, device switcher, per-app mixer
  widgets/clock/       date and time
src-tauri/src/
  lib.rs               app setup
  commands.rs          everything the UI can call
  bar.rs               full-width placement, auto-hide (mouse at top edge), timer alarms
  calendar.rs          iCal feeds: fetch, parse, expand recurring events (5-minute cache)
  window.rs            tray
  suspend.rs           fullscreen / anti-cheat watcher
  platform_win.rs      Win32 fullscreen + process checks
  smtc.rs              Windows media session (SMTC)
  audio_win.rs         Core Audio: volumes, sessions, default device
  system.rs            sysinfo + nvidia-smi + LibreHardwareMonitor
  config.rs            settings file
```

## CPU temperature (optional)

Windows doesn't expose CPU temperature without a sensor driver, so Notch reads it from LibreHardwareMonitor:

1. Download LibreHardwareMonitor and run it as administrator.
2. *Options › Remote Web Server › Run* (default port 8085).
3. Notch settings › tick *CPU temperature from LibreHardwareMonitor* › Save.

LibreHardwareMonitor loads a kernel driver, so **close it before playing games with kernel anti-cheat** (Vanguard, FACEIT). Notch stops reading it during anti-cheat suspend, but it can't close an admin process.

## Known limits

- **GPU stats** are NVIDIA-only (via `nvidia-smi`).
- Output switching uses the same undocumented Windows interface as SoundSwitch; it changes the default for all roles (media, communications).
- The bar sits on the primary monitor.
- The bar can't blur what's behind it (Windows doesn't allow that for a see-through web window), so it uses a near-solid background.
- Calendar is read-only and needs the iCal link; Outlook/Windows Calendar accounts aren't read directly.
