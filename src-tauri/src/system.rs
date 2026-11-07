//! CPU / RAM / disk / network via sysinfo, GPU via nvidia-smi when available,
//! CPU temperature from LibreHardwareMonitor's web server when enabled.
//! Only collected while the notch is open (the frontend stops asking when it's closed).

use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::{Components, Disks, Networks, System};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GpuStats {
    pub name: String,
    pub util: f32,
    pub temp: Option<f32>,
    pub mem_used: u64,
    pub mem_total: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu: f32,
    pub cpu_name: String,
    /// From LibreHardwareMonitor if enabled, otherwise whatever Windows exposes (usually nothing).
    pub cpu_temp: Option<f32>,
    /// "lhm" when the temperature came from LibreHardwareMonitor, "off" when disabled,
    /// "unreachable" when enabled but LHM isn't answering.
    pub temp_source: String,
    pub ram_used: u64,
    pub ram_total: u64,
    pub disk_name: String,
    pub disk_used: u64,
    pub disk_total: u64,
    /// Bytes per second.
    pub net_down: f64,
    pub net_up: f64,
    pub uptime_secs: u64,
    pub gpu: Option<GpuStats>,
}

pub struct SysCache {
    sys: System,
    networks: Networks,
    disks: Disks,
    components: Components,
    last: Instant,
    cpu_name: String,
    /// Skip nvidia-smi after it fails once (no NVIDIA GPU / driver).
    gpu_available: bool,
    /// Last GPU reading and CPU temperature, reused by light polls (bar only, no card open).
    last_gpu: Option<GpuStats>,
    last_temp: (Option<f32>, &'static str),
}

pub struct SysState(pub Arc<Mutex<SysCache>>);

impl Default for SysState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(SysCache::new())))
    }
}

impl SysCache {
    fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_all(); // first usage sample is a baseline
        sys.refresh_memory();
        let cpu_name = sys
            .cpus()
            .first()
            .map(|c| c.brand().trim().to_string())
            .unwrap_or_else(|| "CPU".into());

        Self {
            sys,
            networks: Networks::new_with_refreshed_list(),
            disks: Disks::new_with_refreshed_list(),
            components: Components::new_with_refreshed_list(),
            last: Instant::now(),
            cpu_name,
            gpu_available: true,
            last_gpu: None,
            last_temp: (None, "off"),
        }
    }

    /// `lhm_url` is Some when the LibreHardwareMonitor integration is switched on.
    /// `full` = the CPU card is open: also read the GPU (nvidia-smi) and temperatures. Light polls
    /// (just the bar's CPU graph) skip those and repeat the last values.
    pub fn collect(&mut self, lhm_url: Option<&str>, full: bool) -> SystemStats {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        self.networks.refresh();
        if full {
            self.disks.refresh();
            self.components.refresh();
        }

        let elapsed = self.last.elapsed().as_secs_f64().max(0.001);
        self.last = Instant::now();

        let (rx, tx) = self
            .networks
            .iter()
            .fold((0u64, 0u64), |(rx, tx), (_, n)| (rx + n.received(), tx + n.transmitted()));

        // System drive (C:) if present, otherwise the biggest disk.
        let disk = self
            .disks
            .iter()
            .find(|d| d.mount_point().to_string_lossy().to_uppercase().starts_with("C:"))
            .or_else(|| self.disks.iter().max_by_key(|d| d.total_space()));
        let (disk_name, disk_used, disk_total) = match disk {
            Some(d) => (
                d.mount_point().to_string_lossy().trim_end_matches(['\\', '/']).to_string(),
                d.total_space().saturating_sub(d.available_space()),
                d.total_space(),
            ),
            None => ("–".into(), 0, 0),
        };

        let (cpu_temp, temp_source) = if full {
            let t = self.read_temp(lhm_url);
            self.last_temp = t;
            t
        } else {
            self.last_temp
        };

        let gpu = if !full {
            self.last_gpu.clone()
        } else if self.gpu_available {
            let g = nvidia_smi();
            self.gpu_available = g.is_some();
            self.last_gpu = g.clone();
            g
        } else {
            None
        };

        SystemStats {
            cpu: self.sys.global_cpu_usage(),
            cpu_name: self.cpu_name.clone(),
            cpu_temp,
            temp_source: temp_source.into(),
            ram_used: self.sys.used_memory(),
            ram_total: self.sys.total_memory(),
            disk_name,
            disk_used,
            disk_total,
            net_down: rx as f64 / elapsed,
            net_up: tx as f64 / elapsed,
            uptime_secs: System::uptime(),
            gpu,
        }
    }

    fn read_temp(&mut self, lhm_url: Option<&str>) -> (Option<f32>, &'static str) {
        let sysinfo_temp = self
            .components
            .iter()
            .filter(|c| {
                let l = c.label().to_lowercase();
                l.contains("cpu") || l.contains("package") || l.contains("tctl") || l.contains("core")
            })
            .map(|c| c.temperature())
            .filter(|t| t.is_finite() && *t > 0.0)
            .reduce(f32::max);

        match lhm_url {
            Some(url) => match lhm_cpu_temp(url) {
                Some(t) => (Some(t), "lhm"),
                None => (sysinfo_temp, "unreachable"),
            },
            None => (sysinfo_temp, "off"),
        }
    }
}

fn nvidia_smi() -> Option<GpuStats> {
    let mut cmd = Command::new("nvidia-smi");
    cmd.args([
        "--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total,name",
        "--format=csv,noheader,nounits",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().next()?;
    let parts: Vec<&str> = line.split(',').map(str::trim).collect();
    if parts.len() < 5 {
        return None;
    }
    const MIB: u64 = 1024 * 1024;
    Some(GpuStats {
        util: parts[0].parse().ok()?,
        temp: parts[1].parse().ok(),
        mem_used: parts[2].parse::<u64>().ok()? * MIB,
        mem_total: parts[3].parse::<u64>().ok()? * MIB,
        name: parts[4..].join(","),
    })
}

/// Reads the CPU package temperature from LibreHardwareMonitor's "Remote Web Server"
/// (Options > Remote Web Server > Run). Returns None if it isn't running.
fn lhm_cpu_temp(url: &str) -> Option<f32> {
    let body = ureq::get(url)
        .timeout(Duration::from_millis(600))
        .call()
        .ok()?
        .into_string()
        .ok()?;
    let root: serde_json::Value = serde_json::from_str(&body).ok()?;
    let cpu = find_node(&root, &|n| image(n).contains("cpu"))?;

    // Preferred sensor names: Intel package, AMD Tctl/Tdie, then the hottest core.
    for name in ["CPU Package", "Core (Tctl/Tdie)", "Core Max", "Core Average"] {
        if let Some(t) = find_node(cpu, &|n| text(n) == name && celsius(n).is_some()).and_then(celsius) {
            return Some(t);
        }
    }
    let mut temps = Vec::new();
    collect_temps(cpu, &mut temps);
    temps.into_iter().reduce(f32::max)
}

fn text(n: &serde_json::Value) -> &str {
    n.get("Text").and_then(|v| v.as_str()).unwrap_or("")
}

fn image(n: &serde_json::Value) -> String {
    n.get("ImageURL").and_then(|v| v.as_str()).unwrap_or("").to_lowercase()
}

/// "52.0 °C" or "52,0 °C" (locale dependent) -> 52.0
fn celsius(n: &serde_json::Value) -> Option<f32> {
    let v = n.get("Value")?.as_str()?;
    if !v.contains("°C") {
        return None;
    }
    let num: String = v
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ',' || *c == '-')
        .collect();
    num.replace(',', ".").parse().ok()
}

fn children(n: &serde_json::Value) -> impl Iterator<Item = &serde_json::Value> {
    n.get("Children").and_then(|c| c.as_array()).into_iter().flatten()
}

fn find_node<'a>(n: &'a serde_json::Value, pred: &dyn Fn(&serde_json::Value) -> bool) -> Option<&'a serde_json::Value> {
    if pred(n) {
        return Some(n);
    }
    children(n).find_map(|c| find_node(c, pred))
}

fn collect_temps(n: &serde_json::Value, out: &mut Vec<f32>) {
    if let Some(t) = celsius(n) {
        out.push(t);
    }
    for c in children(n) {
        collect_temps(c, out);
    }
}
