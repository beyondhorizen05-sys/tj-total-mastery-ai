// Desktop-only API supervisor. No machine-wide services or elevated privileges.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use std::sync::Mutex;
use tauri::{Manager, State};

struct BackendState {
    port: u16,
    token_file: Option<PathBuf>,
    diagnostic_log: Option<PathBuf>,
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
    // Report early backend exits rather than returning an opaque API connection error.
    {
        let mut child = state.child.lock().map_err(|_| "Desktop backend supervisor is unavailable")?;
        if let Some(process) = child.as_mut() {
            if let Some(status) = process.try_wait().map_err(|_| "Desktop backend process could not be inspected")? {
                let log = state.diagnostic_log.as_ref().map(|p| p.display().to_string()).unwrap_or_default();
                return Err(format!("Bundled TJ API exited ({status}). Check the startup log: {log}"));
            }
        }
    }
    let path = state.token_file.as_ref().ok_or("Desktop backend token file is unavailable")?;
    let token = fs::read_to_string(path).map_err(|_| "Desktop API is still starting".to_string())?;
    if token.len() != 64 || !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Desktop API token is malformed".into());
    }
    // The launcher writes its token *before* the API listens. Do not hand the
    // frontend a still-closed port and misdiagnose it as a network failure.
    let addr = SocketAddr::from(([127, 0, 0, 1], state.port));
    if TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_err() {
        return Err("Desktop API is starting; the local listener is not ready".into());
    }
    Ok(DesktopConnection { base_url: format!("http://127.0.0.1:{}", state.port), token })
}

fn main() {
    let application = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_api_connection])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.manage(BackendState { port: 4780, token_file: None, diagnostic_log: None, child: Mutex::new(None) });
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
            // Keep the startup error output on the user's machine. Do not
            // expose session tokens or diagnostic logs to remote services.
            // Truncate per launch to keep the file bounded between runs.
            let diagnostic_log = data_dir.join("desktop-backend-startup.log");
            let stderr = OpenOptions::new().create(true).write(true).truncate(true).open(&diagnostic_log)?;
            let stdout = stderr.try_clone()?;
            let mut command = Command::new(&node);
            command.arg(&launcher)
                .current_dir(&api_dir)
                .env("TJ_DATA_DIR", &data_dir)
                .env("TJ_PORT", port.to_string())
                .env("TJ_HOST", "127.0.0.1")
                .env("TJ_DESKTOP_TOKEN_FILE", &token_file)
                .stdout(Stdio::from(stdout))
                .stderr(Stdio::from(stderr));
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            let child = command.spawn()?;
            app.manage(BackendState {
                port, token_file: Some(token_file), diagnostic_log: Some(diagnostic_log), child: Mutex::new(Some(child)),
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
