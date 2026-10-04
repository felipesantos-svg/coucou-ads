// Adapted from vinzdg/codenotch windows adapter (MIT). See public/provider-icons/CODENOTCH-LICENSE.
//! Official Antigravity CLI adapter using native Windows ConPTY.
//!
//! Executes `agy --print /usage` without keeping the full Antigravity IDE running.
//! Windows direct redirected pipes historically return empty output for Antigravity;
//! this module attaches the process to a native Windows Pseudo Console (ConPTY),
//! bounded inside a Windows JobObject with cleanup of all descendant processes on exit or timeout.
//!
//! Output is drained concurrently with bounded storage (64 KB) and sanitized of
//! terminal ANSI escape codes and CR characters.

use crate::usage_meter::QuotaWindow as LimitWindow;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

/// Discover installed official Antigravity CLI (`agy.exe`).
/// Checks `%LOCALAPPDATA%\agy\bin\agy.exe` and `PATH` only (only `.exe` binaries).
pub fn find_agy() -> Option<PathBuf> {
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        let candidate = local.join("agy").join("bin").join("agy.exe");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Some(path_var) = std::env::var_os("PATH") {
        return find_agy_in(&std::env::split_paths(&path_var).filter(|p| p.is_absolute()).collect::<Vec<_>>());
    }
    None
}

/// Helper for testing discovery in explicit directories without touching environment.
fn find_agy_in(dirs: &[PathBuf]) -> Option<PathBuf> {
    for dir in dirs {
        let candidate = dir.join("agy.exe");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Strips ANSI escape sequences (CSI, OSC, 2-character escapes) and normalizes line endings.
fn sanitize_terminal_output(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.peek() {
                Some(&'[') => {
                    chars.next();
                    // CSI sequence: consumes parameter and intermediate bytes, ends with 0x40..=0x7E
                    while let Some(&next) = chars.peek() {
                        chars.next();
                        if ('\x40'..='\x7e').contains(&next) {
                            break;
                        }
                    }
                }
                Some(&']') => {
                    chars.next();
                    // OSC sequence: consumes until BEL (\x07) or ST (\x1b\\)
                    while let Some(next) = chars.next() {
                        if next == '\x07' {
                            break;
                        }
                        if next == '\x1b' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                Some(&next) if ('\x40'..='\x5f').contains(&next) => {
                    // 2-character escape sequence Fe
                    chars.next();
                }
                _ => {}
            }
        } else if c == '\r' {
            if chars.peek() == Some(&'\n') {
                // CRLF -> keep \n on next iteration
                continue;
            } else {
                out.push('\n');
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Parses official Antigravity CLI quota output into `LimitWindow` items.
/// Converts remaining percentage to fraction used (used = 1.0 - remaining / 100).
/// Returns an error on invalid or unrecognized format; never returns dummy 0% quotas.
fn parse_quota(text: &str) -> Result<Vec<LimitWindow>, String> {
    let clean = sanitize_terminal_output(text);
    if !clean.lines().any(|line| line.trim() == "Quota:") {
        return Err("CLI did not return a quota report".into());
    }
    let mut out = Vec::new();
    for line in clean.lines().filter(|line| line.contains("Limit Remaining")) {
        let (left, reset) = line.rsplit_once('%').ok_or("Invalid CLI quota row")?;
        let (label, remaining_str) = left
            .trim()
            .rsplit_once(char::is_whitespace)
            .ok_or("Missing quota percentage")?;
        let remaining = remaining_str
            .parse::<f64>()
            .map_err(|_| "Invalid quota percentage")?;
        if !remaining.is_finite() || !(0.0..=100.0).contains(&remaining) {
            return Err("Quota percentage is out of range".into());
        }
        let reset = chrono::DateTime::parse_from_rfc3339(reset.trim())
            .map_err(|_| "Invalid quota reset time")?
            .timestamp_millis();
        if reset <= 0 {
            return Err("Invalid quota reset time".into());
        }
        let label = label.split_whitespace().collect::<Vec<_>>().join(" ");
        let label = label
            .strip_suffix(" Remaining")
            .ok_or("Unknown quota label")?
            .to_string();
        let short_label = label
            .replace(" Models", "")
            .replace(" models", "")
            .replace(" and ", "/")
            .replace(" Weekly Limit", " · Weekly")
            .replace(" Five Hour Limit", " · 5h");
        // Grouped by model family and named by lane, as the Mac card shows them
        let group = [" Weekly Limit", " Five Hour Limit"]
            .iter()
            .find_map(|s| label.strip_suffix(s))
            .map(String::from);
        let lane = lane_name(&label).filter(|_| group.is_some());
        out.push(LimitWindow {
            label: lane.map_or(short_label, String::from),
            group,
            id: label,
            used: Some((100.0 - remaining) / 100.0),
            resets_at: Some(reset as u64),
            ..Default::default()
        });
    }
    if out.is_empty() {
        return Err("CLI returned no recognised quota windows".into());
    }
    order_lanes(&mut out);
    Ok(out)
}

fn quote_arg(arg: &str) -> String {
    if arg.is_empty() {
        return "\"\"".to_string();
    }
    if !arg.contains([' ', '\t', '\n', '\x0b', '\"']) {
        return arg.to_string();
    }
    let mut res = String::with_capacity(arg.len() + 2);
    res.push('"');
    let mut backslashes = 0;
    for c in arg.chars() {
        if c == '\\' {
            backslashes += 1;
        } else {
            for _ in 0..(if c == '"' {backslashes * 2 + 1} else {backslashes}) { res.push('\\'); }
            backslashes = 0;
            res.push(c);
        }
    }
    for _ in 0..backslashes * 2 {
        res.push('\\');
    }
    res.push('"');
    res
}

/// Spawns a hidden process connected to a native Windows ConPTY (Pseudo Console) inside a JobObject.
/// Drains up to 64 KB of stdout concurrently, enforces timeout, and cleans up all descendants.
#[cfg(windows)]
fn run_cmd_conpty(
    program: &Path,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<String, String> {
    use std::io::Read;
    use std::os::windows::io::FromRawHandle;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
    use windows::Win32::System::Console::{
        ClosePseudoConsole, CreatePseudoConsole, COORD, HPCON,
    };
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        TerminateJobObject, JobObjectExtendedLimitInformation,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Pipes::CreatePipe;
    use windows::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
        InitializeProcThreadAttributeList, ResumeThread, UpdateProcThreadAttribute,
        WaitForSingleObject, CREATE_SUSPENDED,
        EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST,
        PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, STARTUPINFOEXW,
        STARTF_USESTDHANDLES,
    };

    if !program.is_file() {
        return Err(format!("Program not found: {}", program.display()));
    }

    struct Job(HANDLE);
    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    let job = unsafe {
        let h = CreateJobObjectW(None, PCWSTR::null())
            .map_err(|e| format!("Cannot create CLI process job: {e}"))?;
        let job = Job(h);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            std::mem::size_of_val(&limits) as u32,
        )
        .map_err(|e| format!("Cannot configure CLI process job limits: {e}"))?;
        job
    };

    let mut in_read = HANDLE::default();
    let mut in_write = HANDLE::default();
    let mut out_read = HANDLE::default();
    let mut out_write = HANDLE::default();

    unsafe {
        CreatePipe(&mut in_read, &mut in_write, None, 0)
            .map_err(|e| format!("CreatePipe(in) failed: {e}"))?;
        if let Err(e) = CreatePipe(&mut out_read, &mut out_write, None, 0) {
            let _ = CloseHandle(in_read);
            let _ = CloseHandle(in_write);
            return Err(format!("CreatePipe(out) failed: {e}"));
        }
    }

    let console_size = COORD { X: 160, Y: 60 };
    let hpc_res = unsafe { CreatePseudoConsole(console_size, in_read, out_write, 0) };

    unsafe {
        let _ = CloseHandle(in_read);
        let _ = CloseHandle(out_write);
    }

    let hpc = match hpc_res {
        Ok(h) => h,
        Err(e) => {
            unsafe {
                let _ = CloseHandle(in_write);
                let _ = CloseHandle(out_read);
            }
            return Err(format!("CreatePseudoConsole failed: {e}"));
        }
    };

    struct PseudoConsoleGuard(HPCON);
    impl Drop for PseudoConsoleGuard {
        fn drop(&mut self) {
            unsafe {
                ClosePseudoConsole(self.0);
            }
        }
    }
    let _input_guard = Job(in_write);
    let pty_guard = PseudoConsoleGuard(hpc);
    let mut file = unsafe { std::fs::File::from_raw_handle(out_read.0 as _) };
    let reader_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        while let Ok(n) = file.read(&mut chunk) {
            if n == 0 { break; }
            let keep = n.min(65537usize.saturating_sub(buf.len()));
            buf.extend_from_slice(&chunk[..keep]);
        }
        buf
    });

    let mut attr_size = 0usize;
    let _ = unsafe {
        InitializeProcThreadAttributeList(
            None,
            1,
            None,
            &mut attr_size,
        )
    };

    let mut attr_storage = vec![0u8; attr_size];
    let attr_list = LPPROC_THREAD_ATTRIBUTE_LIST(attr_storage.as_mut_ptr() as *mut _);

    struct AttrListGuard(LPPROC_THREAD_ATTRIBUTE_LIST);
    impl Drop for AttrListGuard {
        fn drop(&mut self) {
            unsafe {
                DeleteProcThreadAttributeList(self.0);
            }
        }
    }

    let _attr_guard = unsafe {
        InitializeProcThreadAttributeList(Some(attr_list), 1, None, &mut attr_size)
            .map_err(|e| format!("InitializeProcThreadAttributeList failed: {e}"))?;
        AttrListGuard(attr_list)
    };

    unsafe {
        UpdateProcThreadAttribute(
            attr_list,
            0,
            PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
            Some(hpc.0 as *const core::ffi::c_void),
            std::mem::size_of::<HPCON>(),
            None,
            None,
        )
        .map_err(|e| format!("UpdateProcThreadAttribute failed: {e}"))?;
    }

    let mut cmd_line_str = quote_arg(program.to_str().unwrap_or_default());
    let program_u16: Vec<u16> = program.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    for arg in args {
        cmd_line_str.push(' ');
        cmd_line_str.push_str(&quote_arg(arg));
    }
    let mut cmd_line_u16: Vec<u16> = cmd_line_str.encode_utf16().chain(std::iter::once(0)).collect();

    let cwd_u16: Option<Vec<u16>> = cwd.map(|p| p.as_os_str().encode_wide().chain(std::iter::once(0)).collect());

    let mut si_ex = STARTUPINFOEXW::default();
    si_ex.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    // Prevent inherited parent output handles from bypassing the pseudo console.
    si_ex.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    si_ex.lpAttributeList = attr_list;

    let mut proc_info = PROCESS_INFORMATION::default();

    let spawn_res = unsafe {
        CreateProcessW(
            PCWSTR(program_u16.as_ptr()),
            Some(PWSTR(cmd_line_u16.as_mut_ptr())),
            None,
            None,
            false,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED,
            None,
            cwd_u16.as_ref().map_or(PCWSTR::null(), |v| PCWSTR(v.as_ptr())),
            &si_ex.StartupInfo,
            &mut proc_info,
        )
    };

    if let Err(e) = spawn_res {
        return Err(format!("CreateProcessW failed: {e}"));
    }

    if unsafe { AssignProcessToJobObject(job.0, proc_info.hProcess).is_err() } {
        unsafe {
            let _ = windows::Win32::System::Threading::TerminateProcess(proc_info.hProcess, 1);
            let _ = CloseHandle(proc_info.hThread);
            let _ = CloseHandle(proc_info.hProcess);
        }
        return Err("Cannot attach CLI process to job object".into());
    }

    let resumed = unsafe {
        let result = ResumeThread(proc_info.hThread);
        let _ = CloseHandle(proc_info.hThread);
        result != u32::MAX
    };
    let _process_guard = Job(proc_info.hProcess);
    if !resumed { drop(job); return Err("Cannot resume CLI process".into()); }

    let started = std::time::Instant::now();
    let mut exit_code = 0u32;
    let mut timed_out = false;

    loop {
        let wait = unsafe { WaitForSingleObject(proc_info.hProcess, 100) };
        if wait == WAIT_OBJECT_0 {
            let _ = unsafe { GetExitCodeProcess(proc_info.hProcess, &mut exit_code) };
            break;
        }
        if started.elapsed() >= timeout {
            timed_out = true;
            unsafe {
                let _ = TerminateJobObject(job.0, 1);
            }
            break;
        }
    }

    // Stop our remaining descendants before closing their console.
    drop(job);
    drop(pty_guard);

    let raw_bytes = reader_thread
        .join()
        .map_err(|_| "CLI output reader thread panicked".to_string())?;


    if timed_out {
        return Err("Antigravity CLI quota request timed out".into());
    }

    if exit_code != 0 {
        return Err(format!("Antigravity CLI failed with exit code {exit_code}"));
    }

    if raw_bytes.len() > 65536 {
        return Err("CLI quota output is too large".into());
    }

    let text = String::from_utf8_lossy(&raw_bytes);
    Ok(sanitize_terminal_output(&text))
}

#[cfg(not(windows))]
fn run_cmd_conpty(
    _program: &Path,
    _args: &[&str],
    _cwd: Option<&Path>,
    _timeout: Duration,
) -> Result<String, String> {
    Err("Antigravity CLI runner requires Windows".into())
}

/// Executes official `agy --print /usage` via native ConPTY.
pub fn read_quota() -> Result<Vec<LimitWindow>, String> {
    let agy = find_agy().ok_or("Antigravity CLI is not installed")?;
    let dir = std::env::temp_dir().join("cocou-ads-quota-work");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create CLI working directory: {e}"))?;
    let output = run_cmd_conpty(&agy, &["--sandbox", "--print-timeout", "30s", "--print", "/usage"], Some(&dir), Duration::from_secs(70))?;
    parse_quota(&output)
}


fn lane_name(id: &str) -> Option<&'static str> {
    if id.contains("Weekly") { Some("Semanal") } else if id.contains("Five Hour") { Some("5 horas") } else { None }
}
fn order_lanes(windows: &mut [LimitWindow]) {
    windows.sort_by_key(|w| (w.group.clone(), !w.id.contains("Five Hour")));
}
#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn quotas_are_remaining_not_used() {
   let v=parse_quota("Quota:\nGemini Models Weekly Limit Remaining 94% 2026-09-12T01:47:23Z").unwrap();
   assert!((v[0].used.unwrap()-0.06).abs()<0.00001);
   assert!(parse_quota("Quota:\nGemini Models Weekly Limit Remaining 101% 2026-09-12T01:47:23Z").is_err());
   assert!(parse_quota("sign in required").is_err());
 }
}
