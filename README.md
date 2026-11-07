# Notch

A Dynamic-Island-style notch for Windows 11. Tauri 2 (Rust) + React/Vite.

- **Now playing:** Spotify (or any player) via the Windows media session: art, controls, seekable progress.
- **Audio:** master volume, one-click output device switch, per-app volume mixer. Scroll over the pill to change volume.
- **System:** CPU/RAM/GPU/disk/network/uptime. CPU temperature via LibreHardwareMonitor (optional).
- **Auto-hide** for fullscreen apps and anti-cheat games; **game mode** (mini pill, no hover) when a game is focused.

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

- Hover the pill to expand, move away to close. Click the pill to **pin** it open; click again to close.
- Scroll over the pill to change the volume.
- Gear icon (top right when open) → settings.
- Tray icon → *Show / hide notch* or *Quit*.
- Settings are saved to `%APPDATA%\eu.isaac-dev.notch\config.json`.

## Suspend rules

| Trigger | What happens |
|---|---|
| A fullscreen app is focused (exclusive, or borderless covering the whole monitor) | Notch hides, all polling stops. Maximised windows don't count. |
| Any listed process is running (anti-cheat services / game exes) | Full suspend: hidden, no polling, no sensor access. |
| Hidden from the tray | Same as above until you show it again. |
| A game is focused but not fullscreen (game mode) | Mini pill (art + equaliser only), hover-expand off, slower polling. Click still opens it. Games in Steam/Epic/Riot/Xbox/GOG/EA/Ubisoft folders are detected automatically; add others (e.g. `javaw.exe`) in settings. |

Riot Vanguard's `vgc.exe` runs permanently once installed, so the default list matches the Riot game exes instead. Add any game exe you want covered in settings.

## Adding a widget

1. Create `src/widgets/<name>/index.tsx` exporting a `WidgetDef` (see `src/core/types.ts`).
2. Register it in `src/widgets/index.ts`.
3. If it needs native data, add a Rust command in `src-tauri/src/commands.rs` and list it in `lib.rs`.

The shell handles polling: your `poll.interval()` gets `{ expanded, suspended }` and returns milliseconds, or `null` to pause.

## Project layout

```
src/
  App.tsx              notch shell: hover/pin, expand animation, window sizing
  core/                registry, poll scheduler, store, IPC (+ browser mocks), settings
  widgets/media/       now playing, controls, album-art accent colour
  widgets/audio/       volume, device switcher, per-app mixer, scroll-volume OSD
  widgets/system/      CPU/RAM/GPU rings, disk, network, uptime
src-tauri/src/
  lib.rs               app setup
  commands.rs          everything the UI can call
  window.rs            top-centre placement, tray
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
- The notch sits on the primary monitor.
