//! Window placement (top-centre of the primary monitor) and the tray icon.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

const PILL_W: f64 = 236.0;
const PILL_H: f64 = 36.0;

fn main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    app.get_webview_window("main").ok_or(tauri::Error::WindowNotFound)
}

/// Resize to `width` x `height` logical px and keep it centred on the top edge.
pub fn resize(app: &AppHandle, width: f64, height: f64) -> tauri::Result<()> {
    let win = main_window(app)?;
    win.set_size(LogicalSize::new(width, height))?;

    if let Some(monitor) = win.primary_monitor()? {
        let scale = monitor.scale_factor();
        let origin = monitor.position();
        let size = monitor.size();
        let phys_w = (width * scale).round() as i32;
        let x = origin.x + (size.width as i32 - phys_w) / 2;
        win.set_position(PhysicalPosition::new(x, origin.y))?;
    }
    Ok(())
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    resize(app, PILL_W, PILL_H)?;
    main_window(app)?.show()?;
    Ok(())
}

pub fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show / hide notch", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Notch", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quit])?;

    let mut tray = TrayIconBuilder::with_id("notch")
        .tooltip("Notch")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => crate::suspend::toggle_user_hidden(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
