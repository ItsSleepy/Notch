//! Windows implementation of audio.rs.

// COM method names must match the interface definition.
#![allow(non_snake_case)]

use std::cell::Cell;
use std::collections::BTreeMap;
use std::ffi::c_void;

use windows::core::{interface, Interface, IUnknown, IUnknown_Vtbl, GUID, HRESULT, PCWSTR, PWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{CloseHandle, S_OK};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eCommunications, eConsole, eMultimedia, eRender, AudioSessionStateActive, AudioSessionStateExpired, ERole,
    IAudioSessionControl2, IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume,
    MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

use crate::audio_types::{AudioApp, AudioDevice, AudioSnapshot};

// ---------- COM setup ----------

thread_local! {
    static COM_INIT: Cell<bool> = const { Cell::new(false) };
}

fn ensure_com() {
    COM_INIT.with(|done| {
        if !done.get() {
            // Already-initialised threads return S_FALSE / RPC_E_CHANGED_MODE, both fine.
            let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            done.set(true);
        }
    });
}

fn err(e: windows::core::Error) -> String {
    e.message().to_string()
}

/// Undocumented but long-stable interface used by audio switchers such as SoundSwitch.
/// Only SetDefaultEndpoint is called; the other methods just keep the vtable layout correct.
#[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
unsafe trait IPolicyConfig: IUnknown {
    unsafe fn GetMixFormat(&self, device: PCWSTR, format: *mut *mut c_void) -> HRESULT;
    unsafe fn GetDeviceFormat(&self, device: PCWSTR, default: i32, format: *mut *mut c_void) -> HRESULT;
    unsafe fn ResetDeviceFormat(&self, device: PCWSTR) -> HRESULT;
    unsafe fn SetDeviceFormat(&self, device: PCWSTR, endpoint: *mut c_void, mix: *mut c_void) -> HRESULT;
    unsafe fn GetProcessingPeriod(&self, device: PCWSTR, default: i32, def: *mut i64, min: *mut i64) -> HRESULT;
    unsafe fn SetProcessingPeriod(&self, device: PCWSTR, period: *mut i64) -> HRESULT;
    unsafe fn GetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
    unsafe fn SetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
    unsafe fn GetPropertyValue(&self, device: PCWSTR, key: *const c_void, value: *mut c_void) -> HRESULT;
    unsafe fn SetPropertyValue(&self, device: PCWSTR, key: *const c_void, value: *mut c_void) -> HRESULT;
    unsafe fn SetDefaultEndpoint(&self, device: PCWSTR, role: ERole) -> HRESULT;
    unsafe fn SetEndpointVisibility(&self, device: PCWSTR, visible: i32) -> HRESULT;
}

const CLSID_POLICY_CONFIG: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

// ---------- helpers ----------

fn enumerator() -> Result<IMMDeviceEnumerator, String> {
    ensure_com();
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(err) }
}

fn default_output(en: &IMMDeviceEnumerator) -> Result<IMMDevice, String> {
    unsafe { en.GetDefaultAudioEndpoint(eRender, eConsole).map_err(err) }
}

fn endpoint_volume(dev: &IMMDevice) -> Result<IAudioEndpointVolume, String> {
    unsafe { dev.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).map_err(err) }
}

fn device_id(dev: &IMMDevice) -> Option<String> {
    unsafe {
        let id: PWSTR = dev.GetId().ok()?;
        let s = id.to_string().ok();
        CoTaskMemFree(Some(id.0 as *const c_void));
        s
    }
}

fn device_name(dev: &IMMDevice) -> String {
    unsafe {
        dev.OpenPropertyStore(STGM_READ)
            .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
            .map(|v| v.to_string())
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Audio device".into())
    }
}

fn process_exe(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(handle);
        ok.ok()?;
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let file = path.rsplit(['\\', '/']).next()?.to_string();
        Some(file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(&file).to_string())
    }
}

struct Session {
    pid: u32,
    system: bool,
    active: bool,
    volume: ISimpleAudioVolume,
}

/// All live sessions on the default output device.
fn sessions(dev: &IMMDevice) -> Result<Vec<Session>, String> {
    unsafe {
        let manager = dev.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None).map_err(err)?;
        let list = manager.GetSessionEnumerator().map_err(err)?;
        let count = list.GetCount().map_err(err)?;
        let mut out = Vec::new();
        for i in 0..count {
            let Ok(ctl) = list.GetSession(i) else { continue };
            let state = ctl.GetState().unwrap_or(AudioSessionStateExpired);
            if state == AudioSessionStateExpired {
                continue;
            }
            let Ok(ctl2) = ctl.cast::<IAudioSessionControl2>() else { continue };
            let Ok(volume) = ctl.cast::<ISimpleAudioVolume>() else { continue };
            out.push(Session {
                pid: ctl2.GetProcessId().unwrap_or(0),
                system: ctl2.IsSystemSoundsSession() == S_OK,
                active: state == AudioSessionStateActive,
                volume,
            });
        }
        Ok(out)
    }
}

// ---------- public API ----------

pub fn snapshot() -> Result<AudioSnapshot, String> {
    let en = enumerator()?;
    let dev = default_output(&en)?;
    let default_id = device_id(&dev).unwrap_or_default();

    let (master, muted) = unsafe {
        let ev = endpoint_volume(&dev)?;
        (
            ev.GetMasterVolumeLevelScalar().unwrap_or(0.0),
            ev.GetMute().map(|b| b.as_bool()).unwrap_or(false),
        )
    };

    let mut devices = Vec::new();
    unsafe {
        if let Ok(collection) = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
            for i in 0..collection.GetCount().unwrap_or(0) {
                let Ok(d) = collection.Item(i) else { continue };
                let id = device_id(&d).unwrap_or_default();
                devices.push(AudioDevice {
                    is_default: id == default_id,
                    name: device_name(&d),
                    id,
                });
            }
        }
    }

    // One row per process (Chrome and friends open several sessions).
    let mut apps: BTreeMap<u32, AudioApp> = BTreeMap::new();
    for s in sessions(&dev)? {
        let pid = if s.system { 0 } else { s.pid };
        if let Some(app) = apps.get_mut(&pid) {
            app.active |= s.active;
            continue;
        }
        let exe = if s.system {
            "System sounds".to_string()
        } else {
            match process_exe(pid) {
                Some(e) => e,
                None => continue,
            }
        };
        let (volume, muted) = unsafe {
            (
                s.volume.GetMasterVolume().unwrap_or(1.0),
                s.volume.GetMute().map(|b| b.as_bool()).unwrap_or(false),
            )
        };
        apps.insert(pid, AudioApp { pid, exe, volume, muted, active: s.active });
    }

    // Playing apps first, system sounds last.
    let mut apps: Vec<AudioApp> = apps.into_values().collect();
    apps.sort_by_key(|a| (a.pid == 0, !a.active, a.exe.to_lowercase()));

    Ok(AudioSnapshot { master, muted, devices, apps })
}

pub fn set_master(volume: f32) -> Result<(), String> {
    let en = enumerator()?;
    let ev = endpoint_volume(&default_output(&en)?)?;
    unsafe {
        ev.SetMasterVolumeLevelScalar(volume.clamp(0.0, 1.0), std::ptr::null())
            .map_err(err)
    }
}

/// Adds `delta` (e.g. 0.02) to the master volume and returns the new level.
pub fn nudge_master(delta: f32) -> Result<f32, String> {
    let en = enumerator()?;
    let ev = endpoint_volume(&default_output(&en)?)?;
    unsafe {
        let next = (ev.GetMasterVolumeLevelScalar().map_err(err)? + delta).clamp(0.0, 1.0);
        ev.SetMasterVolumeLevelScalar(next, std::ptr::null()).map_err(err)?;
        if next > 0.0 {
            let _ = ev.SetMute(false, std::ptr::null());
        }
        Ok(next)
    }
}

pub fn set_master_mute(muted: bool) -> Result<(), String> {
    let en = enumerator()?;
    let ev = endpoint_volume(&default_output(&en)?)?;
    unsafe { ev.SetMute(muted, std::ptr::null()).map_err(err) }
}

pub fn set_app(pid: u32, volume: Option<f32>, muted: Option<bool>) -> Result<(), String> {
    let en = enumerator()?;
    let dev = default_output(&en)?;
    let mut hit = false;
    for s in sessions(&dev)? {
        let matches = if pid == 0 { s.system } else { !s.system && s.pid == pid };
        if !matches {
            continue;
        }
        hit = true;
        unsafe {
            if let Some(v) = volume {
                s.volume.SetMasterVolume(v.clamp(0.0, 1.0), std::ptr::null()).map_err(err)?;
            }
            if let Some(m) = muted {
                s.volume.SetMute(m, std::ptr::null()).map_err(err)?;
            }
        }
    }
    if hit {
        Ok(())
    } else {
        Err("that app is no longer playing audio".into())
    }
}

pub fn set_default_device(id: &str) -> Result<(), String> {
    ensure_com();
    let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let policy: IPolicyConfig = CoCreateInstance(&CLSID_POLICY_CONFIG, None, CLSCTX_ALL).map_err(err)?;
        for role in [eConsole, eMultimedia, eCommunications] {
            policy.SetDefaultEndpoint(PCWSTR(wide.as_ptr()), role).ok().map_err(err)?;
        }
    }
    Ok(())
}
