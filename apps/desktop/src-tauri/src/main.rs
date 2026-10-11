// Desktop-only API supervisor. No machine-wide services or elevated privileges.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, State};

struct BackendState {
    port: u16,
    token_file: Option<PathBuf>,
    child: Mutex<Option<Child>>,
}

#[derive(serde::Serialize)]
struct DesktopConnection {
    base_url: String,
    token: String,
}

#[tauri::command]
fn desktop_api_connection(state: State<'_, BackendState>) -> Result<DesktopConnection, String> {
    // Development keeps the existing separately started API and Vite proxy.
    if cfg!(debug_assertions) {
        return Ok(DesktopConnection { base_url: "http://127.0.0.1:4780".into(), token: String::new() });
    }
    let path = state.token_file.as_ref().ok_or("Desktop backend token file is unavailable")?;
    let token = fs::read_to_string(path).map_err(|_| "Desktop API is still starting".to_string())?;
    if token.len() != 64 || !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Desktop API token is malformed".into());
    }
    Ok(DesktopConnection { base_url: format!("http://127.0.0.1:{}", state.port), token })
}

fn main() {
    let application = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_api_connection])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.manage(BackendState { port: 4780, token_file: None, child: Mutex::new(None) });
                return Ok(());
            }
            // resources are staged at build time from Node 22 and the production API.
            let resource_dir = app.path().resource_dir()?;
            let node = resource_dir.join("resources").join("node.exe");
            let api_dir = resource_dir.join("resources").join("api");
            let launcher = api_dir.join("launcher.cjs");
            if !node.is_file() || !launcher.is_file() || !api_dir.join("main.js").is_file() {
                return Err("Packaged TJ API resources are missing; installer is incomplete".into());
            }
            let data_dir = app.path().app_local_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let token_file = data_dir.join(format!("desktop-session-{}.token", std::process::id()));
            let _ = fs::remove_file(&token_file);

            // A random loopback port avoids silently connecting to another local service.
            let listener = TcpListener::bind("127.0.0.1:0")?;
            let port = listener.local_addr()?.port();
            drop(listener);
            let mut command = Command::new(&node);
            command.arg(&launcher)
                .current_dir(&api_dir)
                .env("TJ_DATA_DIR", &data_dir)
                .env("TJ_PORT", port.to_string())
                .env("TJ_HOST", "127.0.0.1")
                .env("TJ_DESKTOP_TOKEN_FILE", &token_file);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            let child = command.spawn()?;
            app.manage(BackendState {
                port, token_file: Some(token_file), child: Mutex::new(Some(child)),
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("TJ desktop failed to initialize");
    application.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = handle.state::<BackendState>();
            if let Ok(mut proc) = state.child.lock() {
                if let Some(mut child) = proc.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            if let Some(path) = &state.token_file { let _ = fs::remove_file(path); }
        }
    });
}
