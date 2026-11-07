mod audio;
mod audio_types;
mod bar;
mod calendar;
mod commands;
mod config;
mod media;
mod media_info;
mod platform;
mod suspend;
mod system;
mod window;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::bar_resize,
            commands::bar_set_hold,
            commands::bar_peek,
            commands::bar_dismiss,
            commands::timer_alarms,
            commands::bar_visible,
            commands::open_target,
            commands::quit_app,
            commands::calendar_events,
            commands::get_config,
            commands::set_config,
            commands::get_suspend,
            commands::media_get,
            commands::media_control,
            commands::system_stats,
            commands::audio_snapshot,
            commands::audio_set_master,
            commands::audio_nudge_master,
            commands::audio_set_master_mute,
            commands::audio_set_app,
            commands::audio_set_device,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(config::ConfigState::load(&handle));
            app.manage(suspend::SuspendState::default());
            app.manage(system::SysState::default());
            app.manage(bar::BarState::default());
            app.manage(calendar::CalState::default());

            bar::init(&handle)?;
            window::build_tray(app)?;
            suspend::spawn_watcher(handle.clone());
            bar::spawn_watcher(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Notch");
}
