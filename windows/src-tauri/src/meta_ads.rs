//! Read-only Meta connector. Fixed HTTPS origin, no writes, no raw error logging.
//! Tokens are never returned to the webview. Report data is kept in memory only.
use std::collections::HashSet;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::WebviewWindow;

const VERSION: &str = "v26.0";
const SERVICE: &str = "app.cocouads.desktop.ads";
const TOKEN_KEY: &str = "meta-user-token";
static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Deserialize, Serialize)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub currency: String,
    pub timezone_name: String,
    pub account_status: Option<u32>,
}
#[derive(Deserialize, Serialize)]
pub struct Action {
    pub action_type: String,
    pub value: String,
}
#[derive(Deserialize, Serialize)]
pub struct Insight {
    pub campaign_id: String,
    pub campaign_name: String,
    pub date_start: String,
    pub date_stop: String,
    pub spend: String,
    pub impressions: String,
    pub clicks: String,
    #[serde(default)]
    pub actions: Vec<Action>,
    #[serde(default)]
    pub website_purchase_roas: Vec<Action>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub account: Account,
    pub campaigns: Vec<CampaignInfo>,
    pub rows: Vec<Insight>,
    pub fetched_at: u64,
    pub api_version: &'static str,
}
#[derive(Deserialize, Serialize)]
pub struct CampaignInfo {
    pub id: String,
    pub name: String,
    pub objective: Option<String>,
    pub effective_status: Option<String>,
}

fn native_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "traffic" { return Err("Abra Gestão de tráfego para conectar o Meta.".into()); }
    Ok(())
}
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, TOKEN_KEY).map_err(|_| "Não foi possível acessar o Gerenciador de Credenciais.".into())
}
fn token() -> Result<String, String> {
    entry()?.get_password().map_err(|_| "Conecte novamente o Meta para continuar.".into())
}
fn valid_account(id: &str) -> bool {
    id.strip_prefix("act_").map(|s| !s.is_empty() && s.len() <= 30 && s.bytes().all(|b| b.is_ascii_digit())).unwrap_or(false)
}
fn api_error(code: i64, status: u16) -> String {
    match code {
        190 | 102 => "Token inválido ou expirado. Gere um novo token no seu aplicativo Meta e reconecte.".into(),
        10 | 200 | 294 => "Acesso negado. Verifique ads_read, as contas atribuídas ao usuário e os requisitos de acesso do aplicativo Meta.".into(),
        4 | 17 | 32 | 613 | 80000 | 80004 => "Limite de consultas do Meta atingido. Aguarde antes de atualizar novamente.".into(),
        _ => format!("O Meta recusou a consulta (HTTP {status}, código {code}). Verifique permissões e configuração no Meta Developers."),
    }
}
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::none()).build()
        .map_err(|_| "Não foi possível preparar a conexão HTTPS.".into())
}
async fn get(client: &reqwest::Client, token: &str, path: &str, params: &[(String, String)]) -> Result<Value, String> {
    let response = client.get(format!("https://graph.facebook.com/{VERSION}/{path}"))
        .bearer_auth(token).query(params).send().await
        .map_err(|_| "Não foi possível acessar o Meta. Verifique a conexão e tente novamente.".to_string())?;
    let status = response.status().as_u16();
    if response.content_length().unwrap_or(0) > 8_000_000 { return Err("Resposta muito grande. Reduza o período.".into()); }
    let bytes = response.bytes().await.map_err(|_| "A resposta do Meta foi interrompida.".to_string())?;
    if bytes.len() > 8_000_000 { return Err("Resposta muito grande. Reduza o período.".into()); }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "O Meta retornou uma resposta inesperada.".to_string())?;
    if !(200..300).contains(&status) || value.get("error").is_some() {
        return Err(api_error(value.pointer("/error/code").and_then(Value::as_i64).unwrap_or(0), status));
    }
    Ok(value)
}
async fn pages(client: &reqwest::Client, token: &str, path: &str, mut params: Vec<(String, String)>) -> Result<Vec<Value>, String> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    params.push(("limit".into(), "100".into()));
    for _ in 0..50 {
        let body = get(client, token, path, &params).await?;
        let data = body.get("data").and_then(Value::as_array).ok_or("Formato inesperado na lista retornada pelo Meta.")?;
        output.extend(data.iter().cloned());
        // Never follow a next URL: it may carry credentials or change the origin.
        if body.pointer("/paging/next").and_then(Value::as_str).filter(|s| !s.is_empty()).is_none() { return Ok(output); }
        let after = body.pointer("/paging/cursors/after").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("Paginação incompleta. Nenhum total parcial foi exibido.")?;
        if !seen.insert(after.to_string()) { return Err("Paginação repetida. Tente novamente mais tarde.".into()); }
        params.retain(|(key, _)| key != "after");
        params.push(("after".into(), after.to_string()));
    }
    Err("Consulta excedeu o limite desta versão. Nenhum total parcial foi exibido.".into())
}
async fn accounts_with(token: &str) -> Result<Vec<Account>, String> {
    let raw = pages(&http_client()?, token, "me/adaccounts", vec![("fields".into(), "id,name,currency,timezone_name,account_status".into())]).await?;
    raw.into_iter().map(|v| {
        let a: Account = serde_json::from_value(v).map_err(|_| "Uma conta retornou dados incompletos.".to_string())?;
        if !valid_account(&a.id) { return Err("O Meta retornou um identificador de conta inválido.".into()); }
        Ok(a)
    }).collect()
}

#[tauri::command]
pub fn meta_ads_status(window: WebviewWindow) -> Result<bool, String> {
    native_only(&window)?;
    match entry()?.get_password() {
        Ok(v) => Ok(!v.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err("Não foi possível consultar a credencial salva.".into()),
    }
}
#[tauri::command]
pub async fn meta_ads_connect(window: WebviewWindow, access_token: String) -> Result<Vec<Account>, String> {
    native_only(&window)?;
    let _guard = LOCK.lock().await;
    let value = access_token.trim();
    if value.len() < 20 || value.len() > 8192 || value.chars().any(char::is_whitespace) {
        return Err("Insira somente o token de acesso de usuário do Meta.".into());
    }
    let accounts = accounts_with(value).await?;
    if accounts.is_empty() { return Err("O token não retornou contas de anúncios. Verifique as contas atribuídas e a permissão ads_read.".into()); }
    entry()?.set_password(value).map_err(|_| "Acesso validado, mas não foi possível salvar a credencial no Windows.".to_string())?;
    Ok(accounts)
}
#[tauri::command]
pub async fn meta_ads_accounts(window: WebviewWindow) -> Result<Vec<Account>, String> {
    native_only(&window)?;
    let _guard = LOCK.lock().await;
    accounts_with(&token()?).await
}
#[tauri::command]
pub async fn meta_ads_report(window: WebviewWindow, account_id: String, days: u32) -> Result<Report, String> {
    native_only(&window)?;
    if !valid_account(&account_id) || ![7, 14, 30].contains(&days) { return Err("Conta ou período inválido.".into()); }
    let _guard = LOCK.lock().await;
    let token = token()?;
    let account = accounts_with(&token).await?.into_iter().find(|a| a.id == account_id).ok_or("A conta não está disponível para esta conexão.")?;
    report_with(&token, account, days).await
}

async fn report_with(token: &str, account: Account, days: u32) -> Result<Report, String> {
    let account_id = &account.id;
    let raw = pages(&http_client()?, &token, &format!("{account_id}/insights"), vec![
        ("fields".into(), "campaign_id,campaign_name,date_start,date_stop,spend,impressions,clicks,actions,website_purchase_roas".into()),
        ("level".into(), "campaign".into()),
        ("date_preset".into(), format!("last_{days}d")),
        ("use_unified_attribution_setting".into(), "true".into()),
        ("action_report_time".into(), "impression".into()),
    ]).await?;
    let rows = raw.into_iter().map(|v| serde_json::from_value(v).map_err(|_| "Relatório com campos inesperados; nenhum total parcial foi exibido.".to_string())).collect::<Result<Vec<Insight>, _>>()?;
    let campaigns = pages(&http_client()?, &token, &format!("{account_id}/campaigns"), vec![("fields".into(), "id,name,objective,effective_status".into())]).await?
        .into_iter().map(|v| serde_json::from_value(v).map_err(|_| "Não foi possível identificar as campanhas da conta.".to_string())).collect::<Result<Vec<CampaignInfo>, _>>()?;
    Ok(Report { account, campaigns, rows, fetched_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(), api_version: VERSION })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRead {
    pub account_ids: Vec<String>,
    pub days: u32,
}

fn validate_chat_read(request: &ChatRead) -> Result<(), String> {
    if request.account_ids.is_empty() || request.account_ids.len() > 50
        || !request.account_ids.iter().all(|id| valid_account(id))
        || ![7, 14, 30].contains(&request.days) {
        return Err("Selecione de 1 a 50 contas em Meta ao vivo e um período de 7, 14 ou 30 dias.".into());
    }
    Ok(())
}

/// Native-only data acquisition for chat. Only typed reporting fields leave here.
pub async fn chat_snapshot(request: &ChatRead) -> Result<(String, String), String> {
    validate_chat_read(request)?;
    let _guard = tokio::time::timeout(Duration::from_secs(60), LOCK.lock()).await
        .map_err(|_| "O Meta está ocupado. Aguarde a atualização do painel e tente novamente.".to_string())?;
    let token = token()?;
    let accounts = accounts_with(&token).await?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(100);
    let mut reports = Vec::<Value>::new();
    let mut failures = Vec::<Value>::new();
    let mut size = 0;
    let mut seen = HashSet::new();
    for id in &request.account_ids {
        if !seen.insert(id) { continue; }
        let Some(account) = accounts.iter().find(|a| &a.id == id).cloned() else {
            failures.push(serde_json::json!({"accountId": id, "error": "Conta indisponível nesta conexão"}));
            continue;
        };
        let name = account.name.clone();
        let result = tokio::time::timeout_at(deadline, report_with(&token, account, request.days)).await;
        match result {
            Ok(Ok(report)) => {
                let value = serde_json::to_value(report).map_err(|_| "Falha ao preparar relatório.".to_string())?;
                let bytes = value.to_string().len();
                if size + bytes > 180_000 {
                    failures.push(serde_json::json!({"accountId": id, "name": name, "error": "Relatório excede o contexto do chat. Selecione menos contas ou reduza o período."}));
                } else { size += bytes; reports.push(value); }
            }
            Ok(Err(error)) => failures.push(serde_json::json!({"accountId": id, "name": name, "error": error})),
            Err(_) => failures.push(serde_json::json!({"accountId": id, "name": name, "error": "Tempo limite da consulta atingido"})),
        }
    }
    let note = format!("Meta: {} conta(s) consultada(s), {} indisponível(is) · últimos {} dias", reports.len(), failures.len(), request.days);
    let snapshot = serde_json::json!({
        "source": "Meta Graph API", "readOnly": true, "days": request.days,
        "actionReportTime": "impression", "useUnifiedAttributionSetting": true,
        "partial": !failures.is_empty(), "reports": reports, "failures": failures,
        "unavailable": ["criativos", "alterações históricas", "diagnósticos Pixel/CAPI", "Google Ads", "receita fora da atribuição Meta"]
    });
    Ok((snapshot.to_string(), note))
}
#[tauri::command]
pub async fn meta_ads_disconnect(window: WebviewWindow) -> Result<(), String> {
    native_only(&window)?;
    let _guard = LOCK.lock().await;
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Não foi possível remover a credencial do Windows.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Opt-in only: reads the named account and sends its report to Anthropic.
    #[test]
    #[ignore = "Requires explicit live-data authorization and saved API credentials"]
    fn live_chat_reads_requested_account() {
        let name = std::env::var("COUCOU_TEST_META_ACCOUNT_NAME").expect("Provide the authorized account name");
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            let accounts = accounts_with(&token().unwrap()).await.unwrap();
            let matches: Vec<_> = accounts.into_iter().filter(|a| a.account_status == Some(1) && a.name.to_lowercase().contains(&name.to_lowercase())).collect();
            if matches.len() != 1 {
                for account in &matches { eprintln!("Matching account: {} ({})", account.name, account.id); }
            }
            assert_eq!(matches.len(), 1, "Account name must match exactly one accessible account");
            let id = matches[0].id.clone();
            let reply = crate::claude::send(&crate::claude::Chat::default(), &crate::settings::load().model,
                "Verificação de acesso: retorne somente o ID completo da conta no snapshot Meta desta pergunta, sem buscar na web.".into(),
                None, Some(ChatRead { account_ids: vec![id.clone()], days: 7 })).await.expect("Live chat request failed");
            assert!(reply.meta_note.as_deref().unwrap_or("").contains("1 conta(s) consultada(s), 0 indisponível(is)"));
            assert!(reply.text.contains(&id), "AI did not identify the account supplied by the live snapshot");
        });
    }
    #[test]
    fn chat_scope_requires_explicit_accounts_and_supported_period() {
        assert!(validate_chat_read(&ChatRead { account_ids: vec!["act_123".into()], days: 7 }).is_ok());
        for request in [
            ChatRead { account_ids: vec![], days: 7 },
            ChatRead { account_ids: vec!["act_123/insights".into()], days: 7 },
            ChatRead { account_ids: vec!["act_123".into()], days: 1 },
        ] { assert!(validate_chat_read(&request).is_err()); }
    }
    #[test]
    fn account_ids_cannot_change_path_or_origin() {
        assert!(valid_account("act_123456"));
        for s in ["act_", "act_123/insights", "https://example.com", "act_123?access_token=x", "act_１２３"] { assert!(!valid_account(s)); }
    }
    #[test]
    fn errors_are_actionable_without_echoing_response_or_credentials() {
        assert!(api_error(190, 400).contains("expirado"));
        assert!(api_error(200, 403).contains("ads_read"));
        assert!(api_error(4, 429).contains("Limite"));
    }
}

