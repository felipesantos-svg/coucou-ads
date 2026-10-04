import { alertPanel } from "./alert-panel";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { publishSummary, SUMMARY_REQUEST, type TrafficSummary } from "../core/traffic-summary";
import { h, clear } from "../views/dom";
import { IS_TAURI } from "../core/bridge";
import { numeric, resultCount, totals, activeAccounts, groupedTotals, objectiveLabel, type Account, type Report } from "./meta-model";

// A single persistent panel keeps in-flight responses bound to their original controls.
const view = h("div", { class: "meta-live" });
let initialized = false, saved = false, busy = false;
let accounts: Account[] = [];
let latestSummary: TrafficSummary | null = null;
let reports: Report[] = [], failures: string[] = [];
let days = "7", action = "", message = "";
const btn = (text: string, run: () => void) => h("button", { class: "button", text, disabled: busy, onclick: run });
function select(label: string, options: [string, string][], value: string, change: (v: string) => void) {
  const el = h("select", { "aria-label": label, disabled: busy });
  for (const [id, text] of options) el.append(h("option", { value: id, text }));
  el.value = value; el.onchange = () => change(el.value); return el;
}
async function run(task: () => Promise<void>) {
  if (busy) return;
  busy = true; message = "Consultando…"; draw();
  try { await task(); message = failures.length ? `Consulta parcial: ${reports.length} contas consultadas; ${failures.length} falhas.` : "Consulta concluída."; }
  catch (error) { message = typeof error === "string" ? error : error instanceof Error ? error.message : "Não foi possível concluir a consulta."; }
  finally { busy = false; draw(); }
}
const SELECTION_KEY = "cocou-ads.meta.selectedAccounts.v1";
let chosen = new Set<string>(), draft = new Set<string>();
let savedSelection: string[] | null = null;
let preferenceError = "";
try {
  const value: unknown = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? "null");
  if (Array.isArray(value) && value.every(id => typeof id === "string" && /^act_\d+$/.test(id))) savedSelection = value;
} catch { preferenceError = "Não foi possível ler a seleção salva."; }
function accept(list: Account[]) {
  accounts = list;
  chosen = new Set((savedSelection ?? activeAccounts(list).map(a => a.id)).filter(id => list.some(a => a.id === id)));
  draft = new Set(chosen); reports = []; failures = []; action = ""; saved = true;
}
function accountPicker() {
  const count = h("p", { text: `${draft.size} contas marcadas. Clique em Aplicar seleção para atualizar o painel.` });
  const list = h("div", { style: "max-height:260px;overflow:auto;display:grid;gap:8px;padding:10px 0" });
  const checks: HTMLInputElement[] = [];
  const update = () => { count.textContent = `${draft.size} contas marcadas. Clique em Aplicar seleção para atualizar o painel.`; };
  for (const account of accounts) {
    const check = h("input", { type: "checkbox", disabled: busy, style: "width:18px;height:18px;flex:none;accent-color:#bcf68d" });
    check.checked = draft.has(account.id);
    check.onchange = () => { if (check.checked) draft.add(account.id); else draft.delete(account.id); update(); };
    checks.push(check);
    list.append(h("label", { style: "display:flex;align-items:center;gap:10px;cursor:pointer" }, check,
      h("span", { text: `${account.name} · ${account.id} · ${account.currency}${account.account_status === 1 ? "" : " · status não ativo ou desconhecido"}` })));
  }
  const mark = (ids: string[]) => { draft = new Set(ids); checks.forEach((check, i) => { check.checked = draft.has(accounts[i].id); }); update(); };
  return h("section", { class: "panel panel-copy" }, h("h2", { text: "Contas exibidas no painel" }),
    h("p", { text: "Marque as contas que deseja acompanhar. Esta seleção não altera o status das contas no Meta." }), count,
    h("div", { class: "filters" }, btn("Marcar todas as ativas", () => mark(activeAccounts(accounts).map(a => a.id))), btn("Desmarcar todas", () => mark([]))), list,
    btn("Aplicar seleção", () => { chosen = new Set(draft); savedSelection = [...chosen];
      try { localStorage.setItem(SELECTION_KEY, JSON.stringify(savedSelection)); preferenceError = ""; }
      catch { preferenceError = "A seleção vale nesta sessão, mas não pôde ser salva neste dispositivo."; }
      void run(loadReport);
    }));
}
async function share() {
  const groups = groupedTotals(reports);
  const first = groups[0];
  latestSummary = first ? {
    account: `${reports.length}/${chosen.size} contas selecionadas${failures.length || reports.length < chosen.size ? " · PARCIAL" : ""}`,
    entries: reports.flatMap(r => {
      const catalog = [...r.campaigns];
      for (const row of r.rows) if (!catalog.some(c => c.id === row.campaign_id)) catalog.push({ id: row.campaign_id, name: row.campaign_name, objective: null, effective_status: null });
      return catalog.filter(c => c.effective_status === "ACTIVE" || r.rows.some(row => row.campaign_id === c.id)).map(c => {
        const row = r.rows.find(row => row.campaign_id === c.id);
        const messages = row ? resultCount(row, "onsite_conversion.messaging_conversation_started_7d") : null;
        return { id: `${r.account.id}/${c.id}`, account: r.account.name, campaign: c.name, objective: objectiveLabel(c.objective), status: c.effective_status === "ACTIVE" ? "Ativa" : c.effective_status === "PAUSED" ? "Pausada" : c.effective_status ?? "Status não informado", currency: r.account.currency, spend: row ? numeric(row.spend) : null, clicks: row ? numeric(row.clicks) : null, impressions: row ? numeric(row.impressions) : null, fetchedAt: r.fetchedAt, messageCost: row && messages && messages > 0 ? numeric(row.spend) / messages : null, roas: row?.website_purchase_roas?.length === 1 && row.website_purchase_roas[0].action_type === "offsite_conversion.fb_pixel_purchase" ? numeric(row.website_purchase_roas[0].value) : null };
      });
    }).sort((a, b) => Number(b.status === "Ativa") - Number(a.status === "Ativa") || a.account.localeCompare(b.account) || a.objective.localeCompare(b.objective)),
    currency: first.currency, spend: first.spend,
    spendLabel: groups.map(g => new Intl.NumberFormat("pt-BR", { style: "currency", currency: g.currency }).format(g.spend)).join(" + "),
    clicks: groups.reduce((n, g) => n + g.clicks, 0), impressions: groups.reduce((n, g) => n + g.impressions, 0),
    days: Number(days), fetchedAt: Math.min(...reports.map(r => r.fetchedAt)),
  } : null;
  await publishSummary(latestSummary);
}
async function loadReport() {
  reports = []; failures = []; await share();
  const targets = accounts.filter(a => chosen.has(a.id));
  for (const [i, account] of targets.entries()) {
    message = `Consultando ${i + 1}/${targets.length}: ${account.name}…`; draw();
    try {
      const next = await invoke<Report>("meta_ads_report", { accountId: account.id, days: Number(days) });
      if (!/^[A-Z]{3}$/.test(next.account.currency)) throw new Error("Moeda inválida.");
      totals(next.rows); for (const row of next.rows) for (const a of row.actions) resultCount(row, a.action_type);
      reports.push(next);
    } catch (error) {
      failures.push(`${account.name} (${account.id}): ${typeof error === "string" ? error : error instanceof Error ? error.message : "Falha na consulta"}`);
    }
  }
  action = ""; await share();
}function draw() {
  clear(view);
  if (!IS_TAURI) { view.append(h("div", { class: "notice", text: "Abra Gestão de tráfego no aplicativo Cocou Ads instalado para conectar o Meta. O navegador exibe apenas a prévia." })); return; }
  view.append(alertPanel(latestSummary, false, draw, () => {}));
  const token = h("input", { type: "password", autocomplete: "off", spellcheck: "false", maxlength: "8192", placeholder: "Token de acesso de usuário com ads_read", "aria-label": "Token Meta", disabled: busy });
  view.append(h("section", { class: "panel panel-copy" }, h("h2", { text: "Sua conexão Meta" }),
    h("p", { text: saved ? "Credencial salva no Windows. As contas são carregadas ao abrir o aplicativo." : "Use um token do seu aplicativo Meta com ads_read e acesso às contas dos clientes." }),
    h("p", { text: "Ao conectar, o token será enviado à API oficial do Meta e salvo no Gerenciador de Credenciais do Windows. Os relatórios ficam apenas nesta sessão. Nunca envie seu token pelo chat." }),
    h("div", { class: "filters" }, token, btn("Validar e salvar token", () => {
      const accessToken = token.value; token.value = "";
      void run(async () => { accept(await invoke<Account[]>("meta_ads_connect", { accessToken })); await loadReport(); });
    }), saved ? btn("Atualizar contas", () => { reports = []; failures = []; accounts = []; void run(async () => { await share(); accept(await invoke<Account[]>("meta_ads_accounts")); await loadReport(); }); }) : null,
    saved ? btn("Remover conexão local", () => { void run(async () => { await invoke("meta_ads_disconnect"); saved = false; accounts = []; reports = []; failures = []; chosen.clear(); draft.clear(); await share(); }); }) : null),
    h("small", { text: "Remover a conexão apaga a credencial deste aplicativo. Para revogar o token, use o Meta. Tokens expirados precisam ser substituídos." })));
  view.append(h("p", { role: "status", "aria-live": "polite", text: message }));
  if (accounts.length) view.append(accountPicker(), h("div", { class: "filters" },
    select("Período real", [ ["7", "Últimos 7 dias"], ["14", "Últimos 14 dias"], ["30", "Últimos 30 dias"] ], days, v => { days = v; void run(loadReport); }),
    btn("Atualizar campanhas", () => { void run(loadReport); })));
  if (preferenceError) view.append(h("p", { role: "alert", text: preferenceError }));
  if (accounts.length && !chosen.size) view.append(h("p", { text: "Nenhuma conta selecionada. Marque as contas acima e aplique a seleção." }));
  for (const failure of failures) view.append(h("p", { class: "notice", role: "alert", text: failure }));
  if (accounts.length) {
    view.append(h("p", { text: "Contas ativas: status ACTIVE informado pelo Meta, mesmo sem campanhas veiculando. Cada período segue o fuso da própria conta." }));
    if (!activeAccounts(accounts).length) view.append(h("p", { text: "Nenhuma conta com status ativo foi retornada. Você pode marcar outras contas disponíveis." }));
  }
  for (const data of reports) {
  const money = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: data.account.currency }).format(n);

  view.append(h("section", { class: "panel panel-copy" }, h("h2", { text: `${data.account.name} · ${data.account.id}` }),
    h("p", { text: `Dados reais · ${data.account.currency} · ${data.account.timezone_name} · API ${data.apiVersion} · consulta ${new Date(data.fetchedAt * 1000).toLocaleString("pt-BR")}` }),
    h("p", { text: "Métricas separadas por campanha. Objetivo e status identificados pelo Meta." }),
    h("p", { text: "Atribuição definida nos conjuntos de anúncios; ações reportadas pela data da impressão. Escolha um único tipo de ação abaixo. Tipos sobrepostos não são somados." })));
  const types = [...new Set(data.rows.flatMap(r => r.actions.map(a => a.action_type)))].sort();
  view.append(select("Tipo de resultado", [["", "Selecione o tipo de resultado"], ...types.map(t => [t, t] as [string, string])], action, v => { action = v; draw(); }));
  const table = h("table", {}, h("thead", {}, h("tr", {}, ...["Campanha", "Objetivo / status", "Período", "Investimento", "Cliques", "Ação selecionada"].map(text => h("th", { text, scope: "col" })))));
  const body = h("tbody");
  for (const row of data.rows) {
    const result = resultCount(row, action);
    const info = data.campaigns.find(c => c.id === row.campaign_id);
    body.append(h("tr", {}, ...[`${row.campaign_name} (${row.campaign_id})`, `${objectiveLabel(info?.objective)} · ${info?.effective_status === "ACTIVE" ? "Ativa" : info?.effective_status === "PAUSED" ? "Pausada" : info?.effective_status ?? "Status não informado"}`, `${row.date_start} a ${row.date_stop}`, money(numeric(row.spend)), numeric(row.clicks).toLocaleString("pt-BR"), result === null ? "—" : result.toLocaleString("pt-BR")].map(text => h("td", { text }))));
  }
  for (const c of data.campaigns.filter(c => c.effective_status === "ACTIVE" && !data.rows.some(row => row.campaign_id === c.id))) {
    body.append(h("tr", {}, ...[`${c.name} (${c.id})`, `${objectiveLabel(c.objective)} · Ativa`, "Sem atividade retornada no período", "—", "—", "—"].map(text => h("td", { text }))));
  }
  table.append(body); view.append(h("div", { class: "table-wrap" }, table));
  if (!data.rows.length) view.append(h("p", { text: "O Meta não retornou atividade de campanhas para esta conta e período." }));
}
}
export function metaView() {
  if (!initialized) {
    initialized = true; draw();
    if (IS_TAURI) {
      void listen(SUMMARY_REQUEST, () => { void share(); });
      void run(async () => { saved = await invoke<boolean>("meta_ads_status"); if (saved) { accept(await invoke<Account[]>("meta_ads_accounts")); await loadReport(); } });
    }
  }
  return view;
}






