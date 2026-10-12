#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{io::{Read, Write}, net::{TcpStream, ToSocketAddrs}, path::PathBuf, process::{Child, Command}, sync::Mutex, thread, time::{Duration, Instant}};
use tauri::{Manager, path::BaseDirectory};

struct ApiProcess(Mutex<Option<Child>>);

fn api_is_ready() -> bool {
    let addr = match "127.0.0.1:4780".to_socket_addrs().ok().and_then(|mut addrs| addrs.next()) { Some(addr) => addr, None => return false };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(250)) { Ok(stream) => stream, Err(_) => return false };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let _ = stream.write_all(b"GET /api/v1/system/status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    let mut response = [0u8; 64];
    stream.read(&mut response).ok().is_some_and(|n| String::from_utf8_lossy(&response[..n]).contains("200 OK"))
}

fn start_api(app: &tauri::App) -> Result<Option<Child>, Box<dyn std::error::Error>> {
    if api_is_ready() { return Ok(None); }
    let resource_dir = app.path().resource_dir()?;
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let (node, entry) = if cfg!(debug_assertions) {
        let root = std::env::current_dir()?;
        (PathBuf::from("node"), root.join("services/api/dist/main.js"))
    } else {
        (app.path().resolve("resources/node.exe", BaseDirectory::Resource)?, app.path().resolve("resources/services/api/dist/main.js", BaseDirectory::Resource)?)
    };
    if !entry.exists() { return Err(format!("TJ API bundle is missing: {}", entry.display()).into()); }
    let mut command = Command::new(node);
    command.arg(entry).current_dir(&resource_dir)
        .env("TJ_DATA_DIR", data_dir)
        .env("TJ_HOST", "127.0.0.1")
        .env("TJ_PORT", "4780")
        .env("NODE_ENV", "production");
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut child = command.spawn()?;
    let deadline = Instant::now() + Duration::from_secs(25);
    while Instant::now() < deadline {
        if api_is_ready() { return Ok(Some(child)); }
        if let Some(status) = child.try_wait()? { return Err(format!("TJ API exited during startup ({status}).").into()); }
        thread::sleep(Duration::from_millis(250));
    }
    let _ = child.kill();
    Err("TJ API did not become ready within 25 seconds.".into())
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let child = start_api(app)?;
            app.manage(ApiProcess(Mutex::new(child)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build TJ desktop app");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
            if let Some(process) = handle.try_state::<ApiProcess>() {
                if let Ok(mut child) = process.0.lock() { if let Some(mut child) = child.take() { let _ = child.kill(); } }
            }
        }
    });
}
