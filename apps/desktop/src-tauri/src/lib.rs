use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const DEFAULT_CAPTURE_SHORTCUT: &str = "CommandOrControl+Alt+Space";
const KEYCHAIN_SERVICE: &str = "app.seijaku.desktop";
const CAPTURE: &str = "capture";

/// The shortcut that is bound now, so a change can release it (unregister_all does not).
struct BoundShortcut(Mutex<Option<Shortcut>>);

#[derive(Serialize, Deserialize, Default)]
struct Config {
    capture_shortcut: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

fn read_config(app: &AppHandle) -> Config {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// The small frameless window from the Quick-Capture board; made on first use, then reused.
fn show_capture(app: &AppHandle) {
    let window = match app.get_webview_window(CAPTURE) {
        Some(w) => w,
        None => match WebviewWindowBuilder::new(
            app,
            CAPTURE,
            WebviewUrl::App("capture".into()),
        )
        .title("Quick capture")
        .inner_size(480.0, 300.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .center()
        .build()
        {
            Ok(w) => w,
            Err(_) => return,
        },
    };
    let _ = window.center();
    let _ = window.show();
    let _ = window.set_focus();
}

fn bind_capture_shortcut(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|_| format!("\"{accelerator}\" is not a shortcut"))?;
    let gs = app.global_shortcut();
    let state = app.state::<BoundShortcut>();
    let mut bound = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(old) = bound.take() {
        let _ = gs.unregister(old);
    }
    gs.on_shortcut(shortcut, |app, _, event| {
        if event.state() == ShortcutState::Pressed {
            show_capture(app);
        }
    })
    .map_err(|e| e.to_string())?;
    *bound = Some(shortcut);
    Ok(())
}

#[tauri::command]
fn capture_shortcut(app: AppHandle) -> String {
    read_config(&app)
        .capture_shortcut
        .unwrap_or_else(|| DEFAULT_CAPTURE_SHORTCUT.into())
}

#[tauri::command]
fn set_capture_shortcut(app: AppHandle, accelerator: String) -> Result<(), String> {
    let before = capture_shortcut(app.clone());
    if let Err(err) = bind_capture_shortcut(&app, &accelerator) {
        // Another program may hold it: keep the old one working.
        let _ = bind_capture_shortcut(&app, &before);
        return Err(err);
    }
    let mut config = read_config(&app);
    config.capture_shortcut = Some(accelerator);
    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    fs::write(config_path(&app)?, json).map_err(|e| e.to_string())
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, "device-token").map_err(|e| e.to_string())
}

/// The device token lives in the OS keychain, never in web storage.
#[tauri::command]
fn token_get() -> Option<String> {
    entry().ok()?.get_password().ok()
}

#[tauri::command]
fn token_set(token: String) -> Result<(), String> {
    entry()?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
fn token_clear() {
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
}

pub fn run() {
    tauri::Builder::default()
        // A second launch (or a seijaku:// link on Windows and Linux) lands here, in the running app.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            capture_shortcut,
            set_capture_shortcut,
            token_get,
            token_set,
            token_clear
        ])
        .setup(|app| {
            app.manage(BoundShortcut(Mutex::new(None)));
            let handle = app.handle().clone();

            // Registers seijaku:// for `tauri dev`; installers do it for release builds.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            let accelerator = capture_shortcut(handle.clone());
            if bind_capture_shortcut(&handle, &accelerator).is_err() {
                let _ = bind_capture_shortcut(&handle, DEFAULT_CAPTURE_SHORTCUT);
            }

            let capture = MenuItem::with_id(app, "capture", "Quick capture", true, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open Seijaku", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&capture, &open, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Seijaku")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "capture" => show_capture(app),
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window keeps the app (and the capture hotkey) alive in the tray.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Seijaku");
}
