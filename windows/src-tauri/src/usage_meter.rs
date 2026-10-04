//! Native quota collection. Credentials stay in native memory, never in IPC or logs.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs::File, io::Read, path::PathBuf, sync::OnceLock, time::{Duration, SystemTime, UNIX_EPOCH}};

#[derive(Default, Clone, Deserialize, Serialize)]
pub struct QuotaWindow {
    pub id: String, pub label: String, pub used: Option<f64>, pub resets_at: Option<u64>,
    #[serde(default)] pub derived: bool, pub group: Option<String>,
}
#[derive(Default, Clone, Deserialize, Serialize)]
pub struct Snapshot {
    pub status: String, pub windows: Vec<QuotaWindow>, pub fetched_at: u64,
}
#[derive(Clone, Serialize)]
pub struct Meter {
    provider: &'static str, snapshot: Option<Snapshot>, message: Option<String>,
    #[serde(skip)] retry_at: u64,
}
struct Cache { meters: Vec<Meter> }
static CACHE: OnceLock<tokio::sync::Mutex<Cache>> = OnceLock::new();
pub fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn good(windows: Vec<QuotaWindow>) -> Option<Snapshot> {
    if windows.is_empty() { None } else { Some(Snapshot{status:"ok".into(),windows,fetched_at:now_ms()}) }
}
fn reset(v: &Value) -> Option<u64> {
    if let Some(v)=v.as_u64(){return Some(if v < 10_000_000_000 {v*1000} else {v});}
    chrono::DateTime::parse_from_rfc3339(v.as_str()?).ok().and_then(|v|v.timestamp_millis().try_into().ok())
}
fn claude_windows(v: &Value) -> Vec<QuotaWindow> {
    let mut out=Vec::new();
    if let Some(limits)=v.get("limits").and_then(Value::as_array) {
        for l in limits.iter().take(20) {
            let (Some(id),Some(p))=(l.get("kind").and_then(Value::as_str),l.get("percent").and_then(Value::as_f64)) else {continue};
            if !(0.0..=100.0).contains(&p) {continue;}
            let id=match id {"five_hour"=>"session","seven_day"|"weekly"=>"weekly_all",other=>other};
            out.push(QuotaWindow{id:id.into(),label:id.into(),used:Some(p/100.0),resets_at:l.get("resets_at").and_then(reset),..Default::default()});
        }
    }
    for (key,id,label) in [("five_hour","session","Sessão atual"),("seven_day","weekly_all","Semanal (todos os modelos)")] {
        if out.iter().any(|w|w.id==id){continue;}
        let Some(w)=v.get(key) else {continue};
        let Some(p)=w.get("utilization").and_then(Value::as_f64).filter(|p|(0.0..=100.0).contains(p)) else {continue};
        out.push(QuotaWindow{id:id.into(),label:label.into(),used:Some(p/100.0),resets_at:w.get("resets_at").and_then(reset),..Default::default()});
    }
    out.sort_by_key(|w|w.id!="session"); out
}
type Failure = (&'static str,u64);
fn claude_dir() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).or_else(||std::env::var_os("USERPROFILE").map(|h|PathBuf::from(h).join(".claude")))
}
fn claude_credential(dir: &std::path::Path) -> Option<(String,Option<u64>)> {
    let mut bytes=Vec::new(); File::open(dir.join(".credentials.json")).ok()?.take(65_537).read_to_end(&mut bytes).ok()?;
    if bytes.len()>65_536{return None;}
    let v:Value=serde_json::from_slice(&bytes).ok()?;
    let oauth=v.get("claudeAiOauth")?;
    Some((oauth.get("accessToken")?.as_str()?.to_owned(),oauth.get("expiresAt").and_then(Value::as_u64)))
}
fn needs_renewal(expiry: Option<u64>, now: u64) -> bool { expiry.is_some_and(|t|t<=now.saturating_add(240_000)) }
fn renew_claude(dir: &std::path::Path) {
    use std::{process::{Command,Stdio}, os::windows::process::CommandExt, sync::atomic::{AtomicU64,Ordering}};
    static LAST:AtomicU64=AtomicU64::new(0);
    let now=now_ms();
    if now.saturating_sub(LAST.load(Ordering::Relaxed))<600_000{return;}
    LAST.store(now,Ordering::Relaxed);
    let mut candidates=Vec::new();
    if let Some(local)=std::env::var_os("LOCALAPPDATA") {candidates.push(PathBuf::from(local).join("Microsoft/WinGet/Links/claude.exe"));}
    if let Some(home)=std::env::var_os("USERPROFILE") {candidates.push(PathBuf::from(home).join(".local/bin/claude.exe"));}
    if let Some(path)=std::env::var_os("PATH") {candidates.extend(std::env::split_paths(&path).filter(|p|p.is_absolute()).map(|p|p.join("claude.exe")));}
    let Some(exe)=candidates.into_iter().find(|p|p.is_file()) else {return};
    let cwd=std::env::temp_dir().join("cocou-ads-claude-auth");
    if std::fs::create_dir_all(&cwd).is_err(){return;}
    // Empty stdin: starts the CLI's own auth renewal, then exits without a prompt.
    // Safe mode disables user hooks, plugins and MCP. No model request is supplied.
    let mut cmd=Command::new(exe);
    cmd.args(["-p","--safe-mode","--no-session-persistence"]).current_dir(cwd)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(0x08000000);
    for (k,_) in std::env::vars_os() {
        let name=k.to_string_lossy();
        if name=="CLAUDECODE" || name.starts_with("CLAUDE_CODE_") || name.starts_with("ANTHROPIC_") {cmd.env_remove(&k);}
    }
    cmd.env("CLAUDE_CONFIG_DIR",dir);
    let Ok(mut child)=cmd.spawn() else {return};
    let deadline=std::time::Instant::now()+Duration::from_secs(30);
    loop {
        match child.try_wait() {Ok(Some(_))=>break,Ok(None) if std::time::Instant::now()<deadline=>std::thread::sleep(Duration::from_millis(100)),_=>{let _=child.kill();let _=child.wait();break;}}
    }
}
async fn claude_auth() -> Result<String,Failure> {
    let dir=claude_dir().ok_or(("Não foi possível localizar a sessão do Claude Code.",300_000))?;
    let Some(mut credential)=claude_credential(&dir) else {return Err(("Medidor sem login no Claude Code (CLI). O Claude Desktop usa outra sessão.",300_000));};
    if needs_renewal(credential.1,now_ms()) {
        let copy=dir.clone();
        let _=tokio::task::spawn_blocking(move ||renew_claude(&copy)).await;
        credential=claude_credential(&dir).ok_or(("Sessão do medidor indisponível após renovação.",300_000))?;
    }
    if credential.1.is_some_and(|t|t<=now_ms()) {return Err(("A sessão do medidor (Claude Code CLI) venceu. A renovação automática falhou; reconecte com claude auth login. Não é necessário fechar o Claude Desktop.",600_000));}
    Ok(credential.0)
}
async fn claude() -> Result<Snapshot,Failure> {
    let auth=claude_auth().await?;
    let client=reqwest::Client::builder().timeout(Duration::from_secs(20)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_|("Falha ao preparar consulta Claude.",300_000))?;
    let response=client.get("https://api.anthropic.com/api/oauth/usage").bearer_auth(auth).header("anthropic-beta","oauth-2025-04-20").send().await.map_err(|_|("Não foi possível consultar Claude.",300_000))?;
    if response.status().as_u16()==429 {
        let wait=response.headers().get("retry-after").and_then(|v|v.to_str().ok()).and_then(|s|s.parse::<u64>().ok().map(|s|s.saturating_mul(1000)).or_else(||chrono::DateTime::parse_from_rfc2822(s).ok().map(|t|(t.timestamp_millis().max(0) as u64).saturating_sub(now_ms())))).unwrap_or(900_000).max(300_000);
        return Err(("Claude limitou as consultas; aguardando antes de tentar novamente.",wait));
    }
    if response.status().as_u16()==401 {return Err(("Sessão do medidor recusada. Reconecte o Claude Code CLI com claude auth login; o Claude Desktop usa outra sessão.",300_000));}
    if !response.status().is_success(){return Err(("Claude recusou a consulta de limites.",300_000));}
    let mut response=response;
    let mut bytes=Vec::new();
    while let Some(chunk)=response.chunk().await.map_err(|_|("Resposta Claude incompleta.",300_000))? {
        if bytes.len()+chunk.len()>262_144{return Err(("Resposta Claude inesperada.",300_000));} bytes.extend_from_slice(&chunk);
    }
    let value=serde_json::from_slice(&bytes).map_err(|_|("Formato Claude não reconhecido.",300_000))?;
    good(claude_windows(&value)).ok_or(("Claude não informou limites válidos.",300_000))
}
async fn collect(id: &str) -> Result<Snapshot,Failure> {
    match id {
        "claude"=>claude().await,
        "codex"=>tokio::task::spawn_blocking(crate::quota_codex::read_app_server).await.ok().flatten().ok_or(("Entre no Codex instalado para consultar seus limites.",300_000)),
        _=>tokio::task::spawn_blocking(crate::quota_agy::read_quota).await.ok().and_then(Result::ok).and_then(good).ok_or(("Não foi possível consultar Antigravity. Verifique o login no agy.",300_000)),
    }
}
async fn readings() -> Vec<Meter> {
    let cache=CACHE.get_or_init(||tokio::sync::Mutex::new(Cache {meters:["claude","codex","antigravity"].into_iter().map(|provider|Meter{provider,snapshot:None,message:None,retry_at:0}).collect()}));
    let mut state=cache.lock().await;
    let mut jobs=Vec::new();
    for (i,m) in state.meters.iter().enumerate() {
        if now_ms()>=m.retry_at { let id=m.provider; jobs.push((i,tokio::spawn(async move {collect(id).await}))); }
    }
    for (i,job) in jobs {
        let result=job.await.unwrap_or(Err(("Consulta temporariamente indisponível.",300_000)));
        let meter=&mut state.meters[i];
        match result {
            Ok(snapshot)=>{meter.snapshot=Some(snapshot);meter.message=None;meter.retry_at=now_ms()+300_000;},
            Err((message,delay))=>{meter.message=Some(message.into());meter.retry_at=now_ms().saturating_add(delay);if let Some(s)=&mut meter.snapshot{s.status="stale".into();}}
        }
    }
    state.meters.clone()
}
#[tauri::command]
pub async fn usage_meter(window:tauri::WebviewWindow)->Result<Vec<Meter>,String> {
    if window.label()!="island" {return Err("Janela não autorizada.".into());}
    Ok(readings().await)
}
#[cfg(test)] mod tests {
 use super::*;
 #[test] fn renew_only_near_expiry() {
    assert!(!needs_renewal(None,1000));
    assert!(!needs_renewal(Some(241001),1000));
    assert!(needs_renewal(Some(241000),1000));
    assert!(needs_renewal(Some(999),1000));
 }
 #[test] #[ignore="Renews existing CLI authentication and queries usage without a prompt"]
 fn live_claude_recovery() {
    let rt=tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let result=rt.block_on(claude());
    assert!(result.is_ok(),"{}",result.err().map(|e|e.0).unwrap_or(""));
    println!("Claude native quota recovered successfully");
 }
 #[test] fn zero_invalid_and_aliases() {
    assert!(claude_windows(&serde_json::json!({"five_hour":{"utilization":101}})).is_empty());
    let w=claude_windows(&serde_json::json!({"limits":[{"kind":"five_hour","percent":0}],"five_hour":{"utilization":1},"seven_day":{"utilization":25}}));
    assert_eq!(w.len(),2); assert_eq!(w[0].used,Some(0.0)); assert_eq!(w[1].id,"weekly_all");
 }
 #[test] #[ignore="Read-only live quota calls via installed clients; no inference"]
 fn live_native_quotas() {
    let rt=tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    for m in rt.block_on(readings()) { println!("{}: {} ({})",m.provider,m.snapshot.as_ref().map(|s|s.status.as_str()).unwrap_or("unavailable"),m.message.as_deref().unwrap_or("quota received")); }
 }
}
