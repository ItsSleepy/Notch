//! Tray icon. Window placement and auto-hide live in bar.rs.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

pub fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let peek = MenuItem::with_id(app, "peek", "Show the bar", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Pause / resume Notch", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Notch", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&peek, &toggle, &quit])?;

    let mut tray = TrayIconBuilder::with_id("notch")
        .tooltip("Notch")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "peek" => crate::bar::peek(app, 4000),
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
