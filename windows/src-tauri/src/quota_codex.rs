// Adapted from vinzdg/codenotch (MIT); see bundled CODENOTCH-LICENSE.
use crate::usage_meter::{Snapshot, QuotaWindow, now_ms};
use std::{path::PathBuf, time::Duration};
fn native_codex() -> Option<PathBuf> {
 let local=std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
 if let Some(local)=local {
   let base=local.join("OpenAI/Codex/bin");
   let mut paths:Vec<_>=std::fs::read_dir(base).ok().into_iter().flatten().filter_map(Result::ok).map(|e| e.path()).collect();
   paths.sort_by_key(|p| std::cmp::Reverse(std::fs::metadata(p).and_then(|m| m.modified()).ok()));
   if let Some(p)=paths.into_iter().map(|p|p.join("codex.exe")).find(|p|p.is_file()) {return Some(p);}
 }
 let appdata=std::env::var_os("APPDATA").map(PathBuf::from);
 if let Some(base)=appdata {
   for p in ["npm/node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/codex/codex.exe", "npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex/codex.exe"] {
     let p=base.join(p); if p.is_file(){return Some(p);}
   }
 }
 std::env::var_os("PATH").and_then(|v| std::env::split_paths(&v).filter(|p|p.is_absolute()).map(|p|p.join("codex.exe")).find(|p|p.is_file()))
}
fn app_server_snapshot(result: &serde_json::Value) -> Option<Snapshot> {
    // A present multi-bucket map is authoritative: never substitute a legacy Spark bucket
    // (or a legacy bucket with no id) when the map does not contain core Codex.
    let core = match result.get("rateLimitsByLimitId").filter(|v| !v.is_null()) {
        Some(buckets) => buckets.get("codex")?,
        None => result.get("rateLimits")?,
    };
    if core.get("limitId").and_then(|x| x.as_str()).map(|id| id != "codex").unwrap_or(false) {
        return None;
    }
    let mut windows = Vec::new();
    for id in ["primary", "secondary"] {
        let Some(w) = core.get(id).filter(|v| v.is_object()) else { continue };
        let Some(used) = w.get("usedPercent").and_then(|x| x.as_f64()) else { continue };
        if !used.is_finite() || !(0.0..=100.0).contains(&used) { continue; }
        windows.push(QuotaWindow {
            id: id.into(),
            label: w.get("windowDurationMins").and_then(|x| x.as_u64()).map(|m| format!("{} h", m as f64 / 60.0)).unwrap_or_else(|| id.into()),
            used: Some(used / 100.0),
            resets_at: w.get("resetsAt").and_then(|x| x.as_u64()).map(|s| s.saturating_mul(1000)),
            ..Default::default()
        });
    }
    if windows.is_empty() { return None; }
    Some(Snapshot { status: "ok".into(), windows, fetched_at: now_ms(),
        ..Default::default() })
}

pub fn read_app_server() -> Option<Snapshot> {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Command, Stdio};
    let mut command = Command::new(native_codex()?);
    command.arg("app-server").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; command.creation_flags(0x0800_0000); }
    let mut child = command.spawn().ok()?;
    let result = (|| {
        let mut input = child.stdin.take()?;
        let output = child.stdout.take()?;
        let (tx, rx) = std::sync::mpsc::sync_channel(16);
        std::thread::spawn(move || {
            let mut output = BufReader::new(output);
            loop {
                let mut bytes = Vec::new();
                use std::io::Read;
                if output.by_ref().take(1_048_577).read_until(b'\n', &mut bytes).ok().filter(|n| *n > 0 && *n <= 1_048_576).is_none() { break; }
                let Ok(line) = String::from_utf8(bytes) else { break };
                if tx.send(line).is_err() { break; }
            }
        });
        writeln!(input, "{}", serde_json::json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"coucou","version":env!("CARGO_PKG_VERSION")}}})).ok()?;
        input.flush().ok()?;
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        loop {
            let line = rx.recv_timeout(deadline.checked_duration_since(std::time::Instant::now())?).ok()?;
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            match v.get("id").and_then(|x| x.as_u64()) {
                Some(1) => {
                    v.get("result")?;
                    writeln!(input, "{}", serde_json::json!({"method":"initialized","params":{}})).ok()?;
                    writeln!(input, "{}", serde_json::json!({"id":2,"method":"account/rateLimits/read"})).ok()?;
                    input.flush().ok()?;
                }
                Some(2) => return app_server_snapshot(v.get("result")?),
                _ => {}
            }
        }
    })();
    // This is a directly launched native executable, never a cmd/node wrapper or a running app.
    let _ = child.kill();
    let _ = child.wait();
    result
}


#[cfg(test)] mod tests {
 use super::*;
 #[test] fn core_only_and_missing_is_not_zero() {
   assert!(app_server_snapshot(&serde_json::json!({"rateLimitsByLimitId":{"spark":{"primary":{"usedPercent":1}}},"rateLimits":{"primary":{"usedPercent":2}}})).is_none());
   assert!(app_server_snapshot(&serde_json::json!({"rateLimits":{"primary":{}}})).is_none());
   let v=app_server_snapshot(&serde_json::json!({"rateLimits":{"primary":{"usedPercent":0,"resetsAt":123}}})).unwrap();
   assert_eq!(v.windows[0].used,Some(0.0)); assert_eq!(v.windows[0].resets_at,Some(123000));
 }
}
