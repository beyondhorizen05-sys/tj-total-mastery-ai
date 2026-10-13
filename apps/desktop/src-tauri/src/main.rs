#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    process::{Child, Command},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{path::BaseDirectory, Manager};

struct ApiProcess(Mutex<Option<Child>>);

fn log_msg(msg: &str) {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = PathBuf::from(appdata).join("com.tj.totalmasteryai");
        let _ = fs::create_dir_all(&dir);
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(dir.join("desktop_startup.log")) {
            let _ = writeln!(f, "[{}] {}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0), msg);
            let _ = f.flush();
        }
    }
}

fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy().to_string();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}

fn api_is_ready() -> bool {
    let addr = match "127.0.0.1:4780".to_socket_addrs().ok().and_then(|mut addrs| addrs.next()) {
        Some(addr) => addr,
        None => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(300)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.write_all(b"GET /api/v1/system/status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    let mut response = [0u8; 128];
    match stream.read(&mut response) {
        Ok(n) if n > 0 => {
            let s = String::from_utf8_lossy(&response[..n]);
            s.contains("200 OK") || s.contains("HTTP/1.1 200")
        }
        _ => false,
    }
}

fn find_resource(app: &tauri::App, rel_path: &str) -> Option<PathBuf> {
    log_msg(&format!("Resolving resource: {}", rel_path));
    // 1. Try Tauri's path resolver
    if let Ok(p) = app.path().resolve(rel_path, BaseDirectory::Resource) {
        log_msg(&format!("  Check 1 (resolve BaseDirectory::Resource): {:?} (exists: {})", p, p.exists()));
        if p.exists() { return Some(p); }
    }

    let stripped = rel_path.strip_prefix("resources/").unwrap_or(rel_path);

    // 2. Try app.path().resource_dir()
    if let Ok(res_dir) = app.path().resource_dir() {
        let p1 = res_dir.join(rel_path);
        log_msg(&format!("  Check 2a (resource_dir + rel): {:?} (exists: {})", p1, p1.exists()));
        if p1.exists() { return Some(p1); }

        let p2 = res_dir.join(stripped);
        log_msg(&format!("  Check 2b (resource_dir + stripped): {:?} (exists: {})", p2, p2.exists()));
        if p2.exists() { return Some(p2); }
    }

    // 3. Try current executable's directory
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let p1 = parent.join(rel_path);
            log_msg(&format!("  Check 3a (exe_dir + rel): {:?} (exists: {})", p1, p1.exists()));
            if p1.exists() { return Some(p1); }

            let p2 = parent.join(stripped);
            log_msg(&format!("  Check 3b (exe_dir + stripped): {:?} (exists: {})", p2, p2.exists()));
            if p2.exists() { return Some(p2); }

            let p3 = parent.join("resources").join(stripped);
            log_msg(&format!("  Check 3c (exe_dir + resources + stripped): {:?} (exists: {})", p3, p3.exists()));
            if p3.exists() { return Some(p3); }
        }
    }

    // 4. Try installed app resources directory in LOCALAPPDATA
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let installed_p = PathBuf::from(local_app_data)
            .join("TJ Total Mastery AI")
            .join("resources")
            .join(stripped);
        log_msg(&format!("  Check 4 (installed app resources): {:?} (exists: {})", installed_p, installed_p.exists()));
        if installed_p.exists() { return Some(installed_p); }
    }

    // 5. Try known workspace development paths
    let dev_base = PathBuf::from(r"C:\Projects\tj-total-mastery-ai");
    let dev_res = dev_base.join("apps/desktop/src-tauri/resources").join(stripped);
    log_msg(&format!("  Check 5a (workspace resources): {:?} (exists: {})", dev_res, dev_res.exists()));
    if dev_res.exists() { return Some(dev_res); }

    // 6. Node.js binary system fallbacks
    if stripped == "node.exe" || rel_path.ends_with("node.exe") {
        for sys_path in [
            r"C:\Program Files\nodejs\node.exe",
            r"C:\Program Files (x86)\nodejs\node.exe",
        ] {
            let p = PathBuf::from(sys_path);
            log_msg(&format!("  Check 6 (system node): {:?} (exists: {})", p, p.exists()));
            if p.exists() { return Some(p); }
        }
    }

    // 7. API main.js workspace fallback
    if stripped.ends_with("main.js") {
        let p = dev_base.join("services/api/dist/main.js");
        log_msg(&format!("  Check 7 (workspace api main.js): {:?} (exists: {})", p, p.exists()));
        if p.exists() { return Some(p); }
    }

    None
}

fn start_api(app: &tauri::App) -> Result<Option<Child>, Box<dyn std::error::Error>> {
    log_msg("start_api called");
    if api_is_ready() {
        log_msg("API is already ready on 127.0.0.1:4780");
        return Ok(None);
    }

    let raw_data_dir = app.path().app_data_dir().unwrap_or_else(|_| {
        std::env::var("APPDATA")
            .map(|a| PathBuf::from(a).join("com.tj.totalmasteryai"))
            .unwrap_or_else(|_| PathBuf::from(".tj-data"))
    });
    let data_dir = strip_verbatim_prefix(raw_data_dir);
    let _ = fs::create_dir_all(&data_dir);
    log_msg(&format!("Using data_dir: {:?}", data_dir));

    let (raw_node, raw_entry) = if cfg!(debug_assertions) {
        let root = std::env::current_dir()?;
        (PathBuf::from("node"), root.join("services/api/dist/main.js"))
    } else {
        let node_path = find_resource(app, "resources/node.exe")
            .or_else(|| find_resource(app, "node.exe"))
            .ok_or_else(|| {
                log_msg("ERROR: node.exe not found");
                "TJ node.exe runtime not found"
            })?;

        let entry_path = find_resource(app, "resources/services/api/dist/main.js")
            .or_else(|| find_resource(app, "services/api/dist/main.js"))
            .ok_or_else(|| {
                log_msg("ERROR: API main.js not found");
                "TJ API bundle main.js not found"
            })?;

        (node_path, entry_path)
    };

    let node = strip_verbatim_prefix(raw_node);
    let entry = strip_verbatim_prefix(raw_entry);
    log_msg(&format!("Cleaned node: {:?}, entry: {:?}", node, entry));

    let working_dir = strip_verbatim_prefix(entry.parent().and_then(|p| p.parent()).unwrap_or(&data_dir).to_path_buf());

    let mut command = Command::new(&node);
    command.arg(&entry)
        .current_dir(&working_dir)
        .env("TJ_DATA_DIR", &data_dir)
        .env("TJ_HOST", "0.0.0.0")
        .env("TJ_PORT", "4780")
        .env("NODE_ENV", "production");

    // Redirect stdout and stderr to log file to avoid broken pipes in GUI subsystem
    if let Ok(out_log) = File::create(data_dir.join("api_stdout.log")) {
        if let Ok(err_log) = out_log.try_clone() {
            command.stdout(out_log).stderr(err_log);
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    log_msg("Spawning API process...");
    let child = command.spawn()?;
    log_msg("Spawned API process successfully.");

    // Check readiness asynchronously in background thread without freezing Windows GUI message loop
    thread::spawn(|| {
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut poll_count = 0;
        while Instant::now() < deadline {
            poll_count += 1;
            if api_is_ready() {
                log_msg("API became ready on port 4780!");
                return;
            }
            if poll_count % 8 == 0 {
                log_msg(&format!("Background check: waiting for API... ({}s elapsed)", poll_count / 4));
            }
            thread::sleep(Duration::from_millis(250));
        }
        log_msg("Background check: reached 30s timeout.");
    });

    Ok(Some(child))
}

fn main() {
    std::panic::set_hook(Box::new(|info| {
        log_msg(&format!("FATAL PANIC: {:?}", info));
    }));

    log_msg("Starting TJ Total Mastery AI desktop app");
    tauri::Builder::default()
        .setup(|app| {
            log_msg("Entered Tauri setup hook");
            match start_api(app) {
                Ok(child) => {
                    log_msg("start_api succeeded, managing child process");
                    app.manage(ApiProcess(Mutex::new(child)));
                }
                Err(err) => {
                    log_msg(&format!("start_api returned non-fatal error: {}", err));
                    app.manage(ApiProcess(Mutex::new(None)));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            log_msg(&format!("Window event: {:?}", event));
            if let tauri::WindowEvent::Destroyed = event {
                log_msg("Window destroyed, terminating background API");
                if let Some(process) = window.try_state::<ApiProcess>() {
                    if let Ok(mut child) = process.0.lock() {
                        if let Some(mut child) = child.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
