//! Phone share: a small HTTP server on the local network so a phone can send files to this PC
//! and fetch files the PC offers. No app on the phone, just the browser.
//!
//! Pairing: the QR code holds `http://<lan-ip>:<port>/?t=<token>`. That visit gets the page plus
//! an HttpOnly, SameSite=Lax cookie; the page also keeps the token and sends it as `X-Token`, for
//! browsers that drop cookies. Every other request needs the cookie or the token, and API calls
//! also need an `X-Notch` header, which a cross-site page can't send without a CORS preflight we
//! never answer.
//! "Reset pairing" makes a new token, which signs every phone out.
//!
//! This file has no Tauri in it, so it can be built and tested on its own; share.rs is the glue.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

pub const DEFAULT_PORT: u16 = 53117;
/// Biggest single upload accepted (8 GB).
const MAX_UPLOAD: u64 = 8 * 1024 * 1024 * 1024;
/// Files offered to the phone at once.
const MAX_OFFERS: usize = 30;
/// Received files remembered for the card.
const MAX_RECEIVED: usize = 30;
const PAGE: &str = include_str!("share_page.html");

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub id: String,
    pub name: String,
    pub size: u64,
    #[serde(skip)]
    pub path: PathBuf,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Received {
    pub name: String,
    pub size: u64,
    /// Unix ms.
    pub at: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ShareEvent {
    /// Bytes of an upload so far (phone → PC).
    Progress { id: String, name: String, done: u64, total: u64 },
    /// An upload finished and was saved.
    Received { id: String, name: String, size: u64 },
    /// An upload failed or was cancelled.
    Failed { id: String, name: String, reason: String },
    /// The phone started downloading an offered file (PC → phone).
    Sent { name: String },
}

#[derive(Serialize, Deserialize, Default)]
struct Saved {
    enabled: bool,
    token: String,
    #[serde(default)]
    received: Vec<Received>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub enabled: bool,
    pub running: bool,
    pub url: Option<String>,
    pub qr_svg: Option<String>,
    pub dir: String,
    pub offers: Vec<Offer>,
    pub received: Vec<Received>,
    pub error: Option<String>,
}

type Notify = Box<dyn Fn(ShareEvent) + Send + Sync>;

struct Inner {
    dir: PathBuf,
    state_path: PathBuf,
    pc_name: String,
    saved: Mutex<Saved>,
    offers: Mutex<Vec<Offer>>,
    server: Mutex<Option<(Arc<Server>, u16)>>,
    error: Mutex<Option<String>>,
    notify: Notify,
}

#[derive(Clone)]
pub struct Share(Arc<Inner>);

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("no OS randomness");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Constant-time compare, so the token can't be guessed byte by byte from response timing.
fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() || a.is_empty() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The address other devices on the network reach this PC at. Connecting a UDP socket sends
/// nothing; it only asks Windows which interface it would route through.
pub fn lan_ip() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.168.0.1:9").or_else(|_| s.connect("10.0.0.1:9")).ok()?;
    let ip = s.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then(|| ip.to_string())
}

/// A filename that's safe to create in the share folder: no folders, no reserved names.
pub fn clean_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let mut s: String = base
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    s = s.trim().trim_matches('.').trim().to_string();
    if s.chars().count() > 180 {
        let (stem, ext) = split_ext(&s);
        let keep: String = stem.chars().take(180 - ext.chars().count().min(20)).collect();
        s = format!("{keep}{ext}");
    }
    let stem = split_ext(&s).0.to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        s = format!("_{s}");
    }
    if s.is_empty() {
        "file".into()
    } else {
        s
    }
}

/// ("photo", ".jpg"); no extension → ("name", "").
fn split_ext(s: &str) -> (&str, &str) {
    match s.rfind('.') {
        Some(i) if i > 0 && s.len() - i <= 12 => (&s[..i], &s[i..]),
        _ => (s, ""),
    }
}

/// `photo.jpg`, then `photo (1).jpg`, `photo (2).jpg`… whichever doesn't exist yet.
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() && !dir.join(format!("{name}.part")).exists() {
        return first;
    }
    let (stem, ext) = split_ext(name);
    (1..10_000)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists() && !p.with_extension("part").exists())
        .unwrap_or_else(|| dir.join(format!("{stem} {}{ext}", random_hex(3))))
}

pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                match u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("zz"), 16) {
                    Ok(v) => {
                        out.push(v);
                        i += 3;
                        continue;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b'+' => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn query_param(url: &str, key: &str) -> Option<String> {
    let q = url.split_once('?')?.1;
    q.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        (k == key).then(|| percent_decode(v))
    })
}

fn header<'a>(req: &'a Request, name: &'static str) -> Option<&'a str> {
    req.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str())
}

fn cookie(req: &Request, name: &str) -> Option<String> {
    header(req, "Cookie")?.split(';').find_map(|c| {
        let (k, v) = c.trim().split_once('=')?;
        (k == name).then(|| v.to_string())
    })
}

fn h(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

/// Headers every response carries.
fn hardened<R: Read>(mut r: Response<R>) -> Response<R> {
    for (k, v) in [
        ("X-Content-Type-Options", "nosniff"),
        ("Referrer-Policy", "no-referrer"),
        ("X-Frame-Options", "DENY"),
        ("Cache-Control", "no-store"),
    ] {
        r.add_header(h(k, v));
    }
    r
}

fn text(status: u16, body: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    hardened(Response::from_string(body).with_status_code(StatusCode(status)).with_header(h("Content-Type", "text/plain; charset=utf-8")))
}

fn json<T: Serialize>(v: &T) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_string(v).unwrap_or_else(|_| "{}".into());
    hardened(Response::from_string(body).with_header(h("Content-Type", "application/json")))
}

const LOCKED_PAGE: &str = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>\
<title>Notch</title><body style='background:#000;color:#eee;font:16px system-ui;display:grid;place-items:center;height:90vh;text-align:center'>\
<div><div style='font-size:42px'>&#128274;</div><p>Not paired.</p><p style='color:#888'>Open the Phone share card in Notch on your PC<br>and scan the QR code again.</p></div>\
<script>try{var t=localStorage.getItem('nt');if(location.search){localStorage.removeItem('nt')}else if(t&&/^[0-9a-f]{32}$/.test(t)){location.replace('/?t='+t)}}catch(e){}</script>";

impl Share {
    /// `dir`: where received files go. `state_path`: share.json (on/off, token, history).
    pub fn new(dir: PathBuf, state_path: PathBuf, pc_name: String, notify: Notify) -> Self {
        let mut saved: Saved = fs::read_to_string(&state_path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        if saved.token.len() < 32 {
            saved.token = random_hex(16);
        }
        let share = Share(Arc::new(Inner {
            dir,
            state_path,
            pc_name,
            saved: Mutex::new(saved),
            offers: Mutex::new(Vec::new()),
            server: Mutex::new(None),
            error: Mutex::new(None),
            notify,
        }));
        share.persist();
        share
    }

    fn persist(&self) {
        let saved = self.0.saved.lock().unwrap();
        if let Some(d) = self.0.state_path.parent() {
            let _ = fs::create_dir_all(d);
        }
        if let Ok(s) = serde_json::to_string_pretty(&*saved) {
            let _ = fs::write(&self.0.state_path, s);
        }
    }

    pub fn enabled(&self) -> bool {
        self.0.saved.lock().unwrap().enabled
    }

    /// Starts the server if sharing is switched on. Call once at startup.
    pub fn start_if_enabled(&self, port: u16) {
        if self.enabled() {
            let _ = self.start(port);
        }
    }

    pub fn set_enabled(&self, on: bool, port: u16) -> Result<(), String> {
        self.0.saved.lock().unwrap().enabled = on;
        self.persist();
        if on {
            self.start(port)
        } else {
            self.stop();
            Ok(())
        }
    }

    /// New token: every paired phone has to scan again.
    pub fn reset_token(&self) {
        self.0.saved.lock().unwrap().token = random_hex(16);
        self.persist();
    }

    pub fn port(&self) -> Option<u16> {
        self.0.server.lock().unwrap().as_ref().map(|(_, p)| *p)
    }

    fn start(&self, port: u16) -> Result<(), String> {
        if self.0.server.lock().unwrap().is_some() {
            return Ok(());
        }
        let _ = fs::create_dir_all(&self.0.dir);
        let mut last_err = String::new();
        for p in port..port.saturating_add(6) {
            match Server::http(("0.0.0.0", p)) {
                Ok(server) => {
                    let server = Arc::new(server);
                    *self.0.server.lock().unwrap() = Some((server.clone(), p));
                    *self.0.error.lock().unwrap() = None;
                    let me = self.clone();
                    std::thread::Builder::new()
                        .name("notch-share".into())
                        .spawn(move || {
                            for req in server.incoming_requests() {
                                let me = me.clone();
                                let _ = std::thread::Builder::new().name("notch-share-req".into()).spawn(move || me.handle(req));
                            }
                        })
                        .map_err(|e| e.to_string())?;
                    return Ok(());
                }
                Err(e) => last_err = e.to_string(),
            }
        }
        let msg = format!("Couldn't open a port for sharing ({last_err})");
        *self.0.error.lock().unwrap() = Some(msg.clone());
        Err(msg)
    }

    pub fn stop(&self) {
        if let Some((server, _)) = self.0.server.lock().unwrap().take() {
            server.unblock();
        }
    }

    pub fn url(&self) -> Option<String> {
        let port = self.port()?;
        let ip = lan_ip()?;
        let token = self.0.saved.lock().unwrap().token.clone();
        Some(format!("http://{ip}:{port}/?t={token}"))
    }

    pub fn status(&self) -> Status {
        let url = self.url();
        let qr_svg = url.as_deref().and_then(qr_svg);
        let saved = self.0.saved.lock().unwrap();
        Status {
            enabled: saved.enabled,
            running: self.port().is_some(),
            url,
            qr_svg,
            dir: self.0.dir.display().to_string(),
            offers: self.0.offers.lock().unwrap().clone(),
            received: saved.received.clone(),
            error: self.0.error.lock().unwrap().clone().or_else(|| {
                (saved.enabled && self.port().is_some() && lan_ip().is_none()).then(|| "Not connected to a network".to_string())
            }),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.0.dir
    }

    /// Offer files to the phone. Folders and missing files are skipped. Returns how many were added.
    pub fn offer(&self, paths: &[String]) -> usize {
        let mut offers = self.0.offers.lock().unwrap();
        let mut added = 0;
        for p in paths {
            let path = PathBuf::from(p);
            let Ok(meta) = fs::metadata(&path) else { continue };
            if !meta.is_file() || offers.iter().any(|o| o.path == path) {
                continue;
            }
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
            offers.push(Offer { id: random_hex(8), name, size: meta.len(), path });
            added += 1;
        }
        let excess = offers.len().saturating_sub(MAX_OFFERS);
        offers.drain(..excess);
        added
    }

    pub fn unoffer(&self, id: &str) {
        self.0.offers.lock().unwrap().retain(|o| o.id != id);
    }

    pub fn clear_offers(&self) {
        self.0.offers.lock().unwrap().clear();
    }

    pub fn clear_received(&self) {
        self.0.saved.lock().unwrap().received.clear();
        self.persist();
    }

    /// Full path of a received file, only if it's one Notch saved and it's still there.
    pub fn received_path(&self, name: &str) -> Option<PathBuf> {
        let known = self.0.saved.lock().unwrap().received.iter().any(|r| r.name == name);
        let p = self.0.dir.join(clean_name(name));
        (known && p.is_file() && p.parent() == Some(self.0.dir.as_path())).then_some(p)
    }

    // ---------- HTTP ----------

    fn authed(&self, req: &Request) -> bool {
        let token = self.0.saved.lock().unwrap().token.clone();
        cookie(req, "nt").is_some_and(|c| same(&c, &token))
            || header(req, "X-Token").is_some_and(|t| same(t, &token))
            || query_param(req.url(), "t").is_some_and(|t| same(&t, &token))
    }

    fn handle(&self, req: Request) {
        let path = req.url().split('?').next().unwrap_or("/").to_string();
        let method = req.method().clone();

        // Pairing link from the QR code (checked like any request below): the page is served
        // straight away with the cookie set. No redirect: a redirect after a link opened from
        // another app (the camera) is treated as cross-site and the cookie gets dropped.
        let pairing = method == Method::Get && path == "/" && query_param(req.url(), "t").is_some();

        if !self.authed(&req) {
            std::thread::sleep(Duration::from_millis(400));
            let r = if path == "/" {
                hardened(Response::from_string(LOCKED_PAGE).with_status_code(401).with_header(h("Content-Type", "text/html; charset=utf-8")))
            } else {
                text(401, "Not paired")
            };
            let _ = req.respond(r);
            return;
        }

        let api = path.starts_with("/api/");
        if api && header(&req, "X-Notch").is_none() {
            let _ = req.respond(text(403, "Missing header"));
            return;
        }

        match (method, path.as_str()) {
            (Method::Get, "/") => {
                // The page only ever reaches a paired phone, so it can carry the token: it keeps a
                // copy and sends it as X-Token, for browsers that won't keep the cookie.
                let token = self.0.saved.lock().unwrap().token.clone();
                let page = PAGE.replace("{{PC}}", &html_escape(&self.0.pc_name)).replace("{{TOKEN}}", &token);
                let mut r = Response::from_string(page)
                    .with_header(h("Content-Type", "text/html; charset=utf-8"))
                    .with_header(h(
                        "Content-Security-Policy",
                        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
                    ));
                if pairing {
                    // Lax (not Strict) so it's sent when the page is opened from another app or the
                    // home screen. Cross-site uploads are still blocked by the X-Notch header check.
                    r.add_header(h("Set-Cookie", &format!("nt={token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax")));
                }
                let _ = req.respond(hardened(r));
            }
            (Method::Get, "/api/list") => {
                #[derive(Serialize)]
                struct List {
                    pc: String,
                    offers: Vec<Offer>,
                }
                let offers = self.0.offers.lock().unwrap().clone();
                let _ = req.respond(json(&List { pc: self.0.pc_name.clone(), offers }));
            }
            (Method::Post, "/api/upload") => self.upload(req),
            (Method::Get, p) if p.starts_with("/f/") => self.download(req, &p[3..].to_string()),
            _ => {
                let _ = req.respond(text(404, "Not found"));
            }
        }
    }

    fn upload(&self, mut req: Request) {
        let name = clean_name(&percent_decode(header(&req, "X-Name").unwrap_or("file")));
        let Some(total) = req.body_length().map(|n| n as u64) else {
            let _ = req.respond(text(411, "Length required"));
            return;
        };
        if total > MAX_UPLOAD {
            let _ = req.respond(text(413, "File too big"));
            return;
        }
        let id = random_hex(6);
        let _ = fs::create_dir_all(&self.0.dir);
        let final_path = free_path(&self.0.dir, &name);
        let final_name = final_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(name);
        let part = self.0.dir.join(format!("{final_name}.part"));

        let result = (|| -> Result<u64, String> {
            let mut file = File::create(&part).map_err(|e| e.to_string())?;
            let reader = req.as_reader();
            let mut buf = vec![0u8; 256 * 1024];
            let mut done = 0u64;
            let mut last = Instant::now() - Duration::from_secs(1);
            (self.0.notify)(ShareEvent::Progress { id: id.clone(), name: final_name.clone(), done: 0, total });
            loop {
                let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                done += n as u64;
                if done > total {
                    return Err("More data than announced".into());
                }
                file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                if last.elapsed() >= Duration::from_millis(150) {
                    last = Instant::now();
                    (self.0.notify)(ShareEvent::Progress { id: id.clone(), name: final_name.clone(), done, total });
                }
            }
            if done != total {
                return Err("Upload was cut off".into());
            }
            file.sync_all().map_err(|e| e.to_string())?;
            drop(file);
            fs::rename(&part, &final_path).map_err(|e| e.to_string())?;
            Ok(done)
        })();

        match result {
            Ok(size) => {
                {
                    let mut saved = self.0.saved.lock().unwrap();
                    saved.received.insert(0, Received { name: final_name.clone(), size, at: now_ms() });
                    saved.received.truncate(MAX_RECEIVED);
                }
                self.persist();
                (self.0.notify)(ShareEvent::Received { id, name: final_name.clone(), size });
                #[derive(Serialize)]
                struct Ok_ {
                    name: String,
                }
                let _ = req.respond(json(&Ok_ { name: final_name }));
            }
            Err(reason) => {
                let _ = fs::remove_file(&part);
                (self.0.notify)(ShareEvent::Failed { id, name: final_name, reason: reason.clone() });
                let _ = req.respond(text(400, &reason));
            }
        }
    }

    fn download(&self, req: Request, id: &str) {
        let offer = self.0.offers.lock().unwrap().iter().find(|o| o.id == id).cloned();
        let Some(offer) = offer else {
            let _ = req.respond(text(404, "No longer shared"));
            return;
        };
        let Ok(file) = File::open(&offer.path) else {
            let _ = req.respond(text(410, "File is gone"));
            return;
        };
        let ascii: String = offer.name.chars().map(|c| if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' { c } else { '_' }).collect();
        let disp = format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{}", percent_encode(&offer.name));
        let r = Response::from_file(file)
            .with_header(h("Content-Type", "application/octet-stream"))
            .with_header(h("Content-Disposition", &disp));
        (self.0.notify)(ShareEvent::Sent { name: offer.name.clone() });
        let _ = req.respond(hardened(r));
    }
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

fn qr_svg(url: &str) -> Option<String> {
    use qrcode::render::svg;
    let code = qrcode::QrCode::with_error_correction_level(url.as_bytes(), qrcode::EcLevel::M).ok()?;
    Some(code.render::<svg::Color>().min_dimensions(168, 168).quiet_zone(true).dark_color(svg::Color("#000000")).light_color(svg::Color("#ffffff")).build())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(clean_name("..\\..\\Windows\\evil.exe"), "evil.exe");
        assert_eq!(clean_name("a/b/c:d?.jpg"), "c_d_.jpg");
        assert_eq!(clean_name("CON.txt"), "_CON.txt");
        assert_eq!(clean_name("com1"), "_com1");
        assert_eq!(clean_name("..."), "file");
        assert_eq!(clean_name(" photo .png "), "photo .png");
        assert_eq!(clean_name("IMG_2041.HEIC"), "IMG_2041.HEIC");
        assert!(clean_name(&"x".repeat(400)).chars().count() <= 180);
    }

    #[test]
    fn decode() {
        assert_eq!(percent_decode("caf%C3%A9%20menu.pdf"), "café menu.pdf");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(percent_decode("a%2"), "a%2");
        assert!(same("abc", "abc") && !same("abc", "abd") && !same("", ""));
    }
}
