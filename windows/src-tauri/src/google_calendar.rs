//! Google Calendar desktop OAuth. Read-only; credentials never returned to UI.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const SERVICE: &str = "app.cocouads.desktop.calendar";
const SCOPES: &str = "https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly";
static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|_| "Não foi possível abrir o cofre do Windows.".into())
}
fn read(key: &str) -> Result<String, String> {
    entry(key)?.get_password().map_err(|_| "Configure e conecte o Google Agenda.".into())
}
fn write(key: &str, value: &str) -> Result<(), String> {
    entry(key)?.set_password(value).map_err(|_| "Não foi possível salvar a conexão no Windows.".into())
}
fn erase(key: &str) -> Result<(), String> {
    match entry(key)?.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(_) => Err("Não foi possível remover a conexão local.".into()) }
}
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "Falha ao preparar conexão.".into())
}
fn native(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "island" { Ok(()) } else { Err("Abra a agenda no Cocou Ads.".into()) }
}
#[derive(Deserialize, Serialize)]
struct Config { client_id: String, client_secret: String }
#[derive(Deserialize)]
struct Imported { installed: Config }
fn parse_config(raw: &str) -> Result<Config, String> {
    if raw.len() > 32_000 { return Err("Arquivo OAuth muito grande.".into()); }
    let config = serde_json::from_str::<Imported>(raw).map_err(|_| "Importe o JSON OAuth do tipo Aplicativo para computador (Desktop).".to_string())?.installed;
    if !config.client_id.ends_with(".apps.googleusercontent.com") || config.client_id.len() > 256 || config.client_secret.is_empty() || config.client_secret.len() > 256 {
        return Err("Configuração OAuth inválida.".into());
    }
    Ok(config)
}
#[derive(Serialize)]
pub struct Status { configured: bool, connected: bool }
#[tauri::command]
pub fn calendar_status(window: tauri::WebviewWindow) -> Result<Status, String> {
    native(&window)?;
    Ok(Status { configured: read("config").is_ok(), connected: read("tokens").is_ok() })
}
#[tauri::command]
pub async fn calendar_configure(window: tauri::WebviewWindow, configuration: String) -> Result<(), String> {
    native(&window)?;
    let config = parse_config(&configuration)?;
    let _guard = LOCK.lock().await;
    erase("tokens")?;
    write("config", &serde_json::to_string(&config).map_err(|_| "Configuração inválida.".to_string())?)
}
#[derive(Serialize, Deserialize)]
struct Tokens { access_token: String, refresh_token: String, expires_at: u64 }
async fn exchange(params: &[(&str, &str)]) -> Result<Value, String> {
    let response = client()?.post("https://oauth2.googleapis.com/token").form(params).send().await.map_err(|_| "Não foi possível acessar o Google.".to_string())?;
    if !response.status().is_success() { return Err("Google recusou a autorização. Confira o cliente Desktop, os usuários de teste e reconecte.".into()); }
    response.json().await.map_err(|_| "Resposta inesperada do Google.".into())
}
fn save_tokens(value: &Value, previous_refresh: &str) -> Result<Tokens, String> {
    let access = value["access_token"].as_str().filter(|s| !s.is_empty()).ok_or("Google não retornou autorização.")?;
    let refresh = value["refresh_token"].as_str().unwrap_or(previous_refresh);
    if refresh.is_empty() { return Err("Google não retornou acesso persistente. Reconecte e autorize a agenda.".into()); }
    let tokens = Tokens { access_token: access.into(), refresh_token: refresh.into(), expires_at: now() + value["expires_in"].as_u64().unwrap_or(3600) };
    write("tokens", &serde_json::to_string(&tokens).map_err(|_| "Falha ao salvar autorização.".to_string())?)?;
    Ok(tokens)
}
fn callback_code(target: &str, state: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| "Retorno OAuth inválido.".to_string())?;
    let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    if url.path() != "/" || pairs.get("state").map(String::as_str) != Some(state) { return Err("Retorno de autorização não reconhecido. Tente conectar novamente.".into()); }
    if pairs.contains_key("error") { return Err("Conexão não autorizada no Google.".into()); }
    pairs.get("code").filter(|s| !s.is_empty()).cloned().ok_or("Código de autorização ausente.".into())
}
#[tauri::command]
pub async fn calendar_connect(window: tauri::WebviewWindow) -> Result<(), String> {
    native(&window)?;
    let _guard = LOCK.try_lock().map_err(|_| "Já existe uma consulta ou conexão em andamento.".to_string())?;
    let config: Config = serde_json::from_str(&read("config")?).map_err(|_| "Importe a configuração OAuth novamente.".to_string())?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|_| "Não foi possível receber o login local.".to_string())?;
    let redirect = format!("http://127.0.0.1:{}/", listener.local_addr().map_err(|_| "Falha no login local.".to_string())?.port());
    let verifier = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let state = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = reqwest::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("client_id", config.client_id.as_str()), ("redirect_uri", &redirect), ("response_type", "code"),
        ("scope", SCOPES), ("state", &state), ("code_challenge", &challenge), ("code_challenge_method", "S256"),
        ("access_type", "offline"), ("prompt", "consent select_account"),
    ]);
    crate::open_url(url.to_string());
    tokio::time::timeout(Duration::from_secs(180), async {
        let (mut socket, _) = listener.accept().await.map_err(|_| "Login local interrompido.".to_string())?;
        let mut buffer = Vec::new();
        loop {
            let mut part = [0u8; 1024];
            let count = socket.read(&mut part).await.map_err(|_| "Retorno de login interrompido.".to_string())?;
            if count == 0 { return Err("Retorno de login incompleto.".into()); }
            buffer.extend_from_slice(&part[..count]);
            if buffer.len() > 16_384 { return Err("Retorno de login muito grande.".into()); }
            if buffer.windows(4).any(|w| w == b"\r\n\r\n") { break; }
        }
        let request = String::from_utf8_lossy(&buffer);
        let target = request.lines().next().unwrap_or("").strip_prefix("GET ").and_then(|s| s.split_whitespace().next()).unwrap_or("");
        let result = async {
            let code = callback_code(target, &state)?;
            let value = exchange(&[("client_id", &config.client_id), ("client_secret", &config.client_secret), ("code", &code), ("code_verifier", &verifier), ("redirect_uri", &redirect), ("grant_type", "authorization_code")]).await?;
            save_tokens(&value, "")?;
            Ok::<_, String>(())
        }.await;
        let body = if result.is_ok() { "Conexao concluida. Volte ao Cocou Ads." } else { "A conexao nao foi concluida. Volte ao Cocou Ads para verificar." };
        let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
        let _ = socket.write_all(reply.as_bytes()).await;
        result
    }).await.map_err(|_| "Tempo de login esgotado. Clique em Conectar novamente.".to_string())?
}
async fn access_token() -> Result<String, String> {
    let tokens: Tokens = serde_json::from_str(&read("tokens")?).map_err(|_| "Reconecte o Google Agenda.".to_string())?;
    if tokens.expires_at > now() + 60 { return Ok(tokens.access_token); }
    let config: Config = serde_json::from_str(&read("config")?).map_err(|_| "Importe a configuração OAuth novamente.".to_string())?;
    let value = exchange(&[("client_id", &config.client_id), ("client_secret", &config.client_secret), ("refresh_token", &tokens.refresh_token), ("grant_type", "refresh_token")]).await?;
    Ok(save_tokens(&value, &tokens.refresh_token)?.access_token)
}
async fn fetch(url: reqwest::Url, token: &str) -> Result<Value, String> {
    let response = client()?.get(url).bearer_auth(token).send().await.map_err(|_| "Sem conexão com o Google Agenda.".to_string())?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 => "A autorização expirou. Reconecte o Google Agenda.",
            403 => "Acesso negado. Habilite a Google Calendar API e autorize os dois acessos de leitura.",
            404 => "Agenda indisponível. Escolha outra agenda.",
            429 => "Limite de consultas atingido. Aguarde antes de atualizar.",
            _ => "O Google não conseguiu carregar a agenda. Tente novamente.",
        }.into());
    }
    response.json().await.map_err(|_| "Resposta inesperada do Google Agenda.".into())
}
#[tauri::command]
pub async fn calendar_list(window: tauri::WebviewWindow) -> Result<Value, String> {
    native(&window)?;
    let _guard = LOCK.lock().await;
    let token = access_token().await?;
    let mut items = Vec::new();
    let mut page = String::new();
    for _ in 0..20 {
        let mut url = reqwest::Url::parse("https://www.googleapis.com/calendar/v3/users/me/calendarList").unwrap();
        url.query_pairs_mut().append_pair("maxResults", "250").append_pair("fields", "items(id,summary,primary,timeZone,selected,hidden),nextPageToken");
        if !page.is_empty() { url.query_pairs_mut().append_pair("pageToken", &page); }
        let body = fetch(url, &token).await?;
        items.extend(body["items"].as_array().cloned().unwrap_or_default());
        match body["nextPageToken"].as_str() { Some(s) if !s.is_empty() => page = s.into(), _ => return Ok(json!(items)) }
    }
    Err("Há muitas agendas para listar. Tente uma conta com menos agendas.".into())
}
#[tauri::command]
pub async fn calendar_events(window: tauri::WebviewWindow, calendar_id: String, time_min: String, time_max: String) -> Result<Value, String> {
    native(&window)?;
    if calendar_id.is_empty() || calendar_id.len() > 1024 || time_min.len() > 40 || time_max.len() > 40 { return Err("Agenda ou período inválido.".into()); }
    let _guard = LOCK.lock().await;
    let token = access_token().await?;
    let mut url = reqwest::Url::parse("https://www.googleapis.com/calendar/v3/calendars/").unwrap();
    url.path_segments_mut().unwrap().pop_if_empty().push(&calendar_id).push("events");
    url.query_pairs_mut().extend_pairs([
        ("timeMin", time_min.as_str()), ("timeMax", time_max.as_str()), ("singleEvents", "true"), ("orderBy", "startTime"),
        ("showDeleted", "false"), ("maxResults", "100"), ("fields", "timeZone,items(id,summary,start,end,htmlLink,location,status),nextPageToken"),
    ]);
    let body = fetch(url, &token).await?;
    Ok(json!({"items": body["items"], "timeZone": body["timeZone"], "hasMore": body["nextPageToken"].is_string(), "fetchedAt": now()}))
}
#[tauri::command]
pub async fn calendar_disconnect(window: tauri::WebviewWindow) -> Result<(), String> {
    native(&window)?;
    let _guard = LOCK.lock().await;
    erase("tokens")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Read-only inspection of connected calendars and next-week counts"]
    fn live_calendar_coverage() {
        let rt=tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let token=access_token().await.expect("Calendar authorization");
            let mut url=reqwest::Url::parse("https://www.googleapis.com/calendar/v3/users/me/calendarList").unwrap();
            url.query_pairs_mut().append_pair("fields","items(id,summary,primary,selected,hidden),nextPageToken").append_pair("maxResults","250");
            let body=fetch(url,&token).await.unwrap();
            for c in body["items"].as_array().unwrap() {
                let mut url=reqwest::Url::parse("https://www.googleapis.com/calendar/v3/calendars/").unwrap();
                url.path_segments_mut().unwrap().pop_if_empty().push(c["id"].as_str().unwrap()).push("events");
                url.query_pairs_mut().extend_pairs([("timeMin","2026-10-05T00:00:00-03:00"),("timeMax","2026-10-12T00:00:00-03:00"),("singleEvents","true"),("maxResults","100"),("fields","items(id),nextPageToken")]);
                match fetch(url,&token).await {
                    Ok(v)=>println!("{}: primary={} selected={} hidden={} events={} more={}",c["summary"],c["primary"],c["selected"],c["hidden"],v["items"].as_array().map_or(0,|a|a.len()),v["nextPageToken"].is_string()),
                    Err(e)=>println!("{}: {}",c["summary"],e),
                }
            }
        });
    }
    #[test]
    fn rejects_wrong_state_denial_and_missing_code() {
        assert_eq!(callback_code("/?state=ok&code=abc", "ok").unwrap(), "abc");
        for target in ["/?state=wrong&code=abc", "/?state=ok&error=access_denied", "/?state=ok", "/other?state=ok&code=abc"] { assert!(callback_code(target, "ok").is_err()); }
    }
    #[test]
    fn only_desktop_configuration_is_accepted() {
        assert!(parse_config(r#"{"web":{"client_id":"a.apps.googleusercontent.com","client_secret":"s"}}"#).is_err());
        assert!(parse_config(r#"{"installed":{"client_id":"a.apps.googleusercontent.com","client_secret":"s"}}"#).is_ok());
    }
    #[test]
    fn pkce_matches_rfc7636() {
        assert_eq!(URL_SAFE_NO_PAD.encode(Sha256::digest(b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
}
