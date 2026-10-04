import { listen } from "@tauri-apps/api/event";
import "./style.css";
import { metaView } from "./meta";
import { h, clear } from "../views/dom";
import { Bridge, IS_TAURI } from "../core/bridge";
import { DEMO_CLIENTS, DEMO_CAMPAIGNS, PLATFORM_NAME, metrics, summarize, ratio, change, alerts, type Client, type Platform, type Campaign } from "./model";

const root = document.getElementById("traffic-root")!;
const KEY = "cocou-ads.traffic.prototype.v1";
const money = (cents: number | null) => cents === null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const number = (v: number) => v.toLocaleString("pt-BR");
let clients: Client[] = DEMO_CLIENTS.map(c => ({ ...c }));
let reviewed = new Set<string>();
let storageError = "";
try {
  const stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
  if (stored?.version === 1) {
    if (Array.isArray(stored.clients)) for (const c of stored.clients) {
      if (c && typeof c.id === "string" && c.id.startsWith("local-") && typeof c.name === "string" && c.name.trim() && ["sales", "leads"].includes(c.objective) && Number.isSafeInteger(c.monthlyBudget) && c.monthlyBudget > 0 && Number.isSafeInteger(c.targetCpa) && c.targetCpa > 0) clients.push({ ...c, name: c.name.slice(0, 80), demo: false });
    }
    if (Array.isArray(stored.reviewed)) reviewed = new Set(stored.reviewed.filter((s: unknown) => typeof s === "string"));
  }
} catch { storageError = "Não foi possível ler os dados locais. Os exemplos continuam disponíveis."; }
let selected = clients[0].id;
let days = 7;
let platform: "all" | Platform = "all";
let tab: "overview" | "campaigns" | "alerts" | "clients" | "connections" | "meta" = "meta";
let query = "";
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, clients: clients.filter(c => !c.demo), reviewed: [...reviewed] })); storageError = ""; }
  catch { storageError = "Não foi possível salvar neste dispositivo. As alterações desta sessão podem ser perdidas."; }
}
const client = () => clients.find(c => c.id === selected)!;
const campaigns = () => DEMO_CAMPAIGNS.filter(c => c.clientId === selected && (platform === "all" || c.platform === platform));
const button = (text: string, action: () => void, cls = "button") => h("button", { class: cls, text, onclick: action });
const badge = (text: string, cls = "") => h("span", { class: `badge ${cls}`, text });
function selectControl(label: string, options: [string, string][], value: string, action: (v: string) => void) {
  const select = h("select", { "aria-label": label });
  for (const [id, text] of options) select.append(h("option", { value: id, text }));
  select.value = value;
  select.addEventListener("change", () => action(select.value));
  return select;
}
function empty(title: string, detail: string) { return h("div", { class: "empty" }, h("span", { class: "empty-icon", text: "↗" }), h("h2", { text: title }), h("p", { text: detail }), button("Ver conexões", () => { tab = "connections"; render(); }, "button primary")); }
function panel(title: string, subtitle: string, body: HTMLElement) { return h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", { text: title }), h("p", { text: subtitle })), body); }
function metricCard(label: string, value: string, detail: string, accent = "") { return h("div", { class: `metric ${accent}` }, h("span", { class: "eyebrow", text: label }), h("strong", { text: value }), h("span", { class: "muted", text: detail })); }
function render() {
  clear(root);
  const c = client();
  const allAlerts = alerts(campaigns(), c, days);
  const pending = allAlerts.filter(a => !reviewed.has(a.id));
  const side = h("aside", { class: "sidebar" },
    h("div", { class: "brand" }, h("span", { class: "brand-mark", text: "↗" }), h("div", {}, h("strong", { text: "Tráfego" }), h("small", { text: "Assistente no seu desktop" }))),
    h("span", { class: "nav-label", text: "ÁREA DE TRABALHO" }));
  const nav: [typeof tab, string, string][] = [["meta", "Meta ao vivo", "∞"], ["overview", "Visão geral", "◫"], ["campaigns", "Campanhas", "▤"], ["alerts", "Alertas · exemplo", "◉"], ["clients", "Clientes", "◷"], ["connections", "Conexões", "⇄"]];
  const menu = h("nav", { "aria-label": "Navegação principal" });
  for (const [key, text, icon] of nav) {
    const item = button("", () => { tab = key; render(); }, `nav-item ${tab === key ? "active" : ""}`);
    item.setAttribute("aria-label", text);
    item.setAttribute("aria-current", tab === key ? "page" : "false");
    item.append(h("span", { class: "nav-icon", text: icon, "aria-hidden": "true" }), h("span", { text }));
    if (key === "alerts" && pending.length) item.append(h("b", { class: "count", text: String(pending.length) }));
    menu.append(item);
  }
  side.append(menu, h("div", { class: "sidebar-bottom" }, badge("PRÉVIA LOCAL", "demo"), h("p", { text: "Consulte suas contas em Meta ao vivo. As demais telas usam exemplos separados." })));
  const main = h("main");
  const titles = { meta: ["Meta ao vivo", "Contas dos seus clientes · consultas somente de leitura"], overview: ["Seu dia, em perspectiva.", "Resultados por plataforma e prioridades para revisar."], campaigns: ["Campanhas", "Compare desempenho sem perder o contexto."], alerts: ["Sua fila de atenção", "Sinais para investigar. Você decide o próximo passo."], clients: ["Seus clientes", "Organize objetivos e metas em um só lugar."], connections: ["Conecte suas fontes", "Meta Ads e Google Ads, cada um com seu acesso autorizado."] };
  main.append(h("header", { class: "topbar" }, h("span", { text: "ÁREA DE TRABALHO / GESTÃO DE TRÁFEGO" }), badge(tab === "meta" ? "Meta · conexão real" : "Protótipo · dados demonstrativos", "demo")));
  main.append(h("div", { class: "page-heading" }, h("div", {}, h("h1", { text: titles[tab][0] }), h("p", { text: titles[tab][1] })), button("+ Novo cliente", showClientForm, "button primary")));
  if (storageError) main.append(h("div", { class: "notice", role: "alert", text: storageError }));
  if (!["clients", "connections", "meta"].includes(tab)) {
    main.append(h("div", { class: "filters" },
      selectControl("Cliente", clients.map(c => [c.id, c.name + (c.demo ? " · exemplo" : "")]), selected, v => { selected = v; render(); }),
      selectControl("Plataforma", [["all", "Todas as plataformas"], ["meta", "Meta Ads"], ["google", "Google Ads"]], platform, v => { platform = v as typeof platform; render(); }),
      selectControl("Período", [["7", "Últimos 7 dias"], ["14", "Últimos 14 dias"]], String(days), v => { days = Number(v); render(); }),
      h("span", { class: "filter-note", text: c.demo ? "Cenário simulado · BRL · sem sincronização" : "Aguardando conexão de uma conta" })));
  }
  if (tab === "meta") main.append(metaView());
  else if (tab === "clients") main.append(clientsView());
  else if (tab === "connections") main.append(connectionsView());
  else if (!campaigns().length) main.append(empty("Seu espaço está pronto", "Este cliente ainda não tem contas conectadas. Os exemplos ficam separados dos seus dados."));
  else if (tab === "overview") main.append(overview());
  else if (tab === "campaigns") main.append(campaignsView());
  else main.append(alertsView());
  main.append(h("footer", { text: tab === "meta" ? "Meta API · atualização manual · nenhuma alteração em campanhas" : "Dados fictícios para validar a experiência. Nenhuma recomendação altera campanhas." }));
  root.append(side, main);
}
function overview() {
  const c = client(), rows = campaigns();
  const total = summarize(rows.map(r => metrics(r, days)));
  const before = summarize(rows.map(r => metrics(r, days, true)));
  const delta = change(total.spend, before.spend);
  const wrap = h("div");
  const stats = h("div", { class: "metrics-grid" }, metricCard("INVESTIMENTO", money(total.spend), delta === null ? "Sem base de comparação" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1).replace(".", ",")}% vs. período anterior`, "featured"));
  for (const p of ["meta", "google"] as Platform[]) {
    const included = rows.filter(r => r.platform === p);
    const m = summarize(included.map(r => metrics(r, days)));
    stats.append(metricCard(`${p === "meta" ? "META" : "GOOGLE"} · ${c.objective === "sales" ? "COMPRAS" : "LEADS"}`, included.length ? number(m.conversions) : "—", included.length ? `${c.objective === "sales" ? "CPA" : "CPL"} ${money(ratio(m.spend, m.conversions))} · atribuídos` : "Fora do filtro"));
  }
  const pending = alerts(rows, c, days).filter(a => !reviewed.has(a.id));
  stats.append(metricCard("PARA REVISAR", String(pending.length), "Alertas demonstrativos", "amber"));
  wrap.append(stats, h("p", { class: "attribution-note", text: "Resultados por plataforma: uma mesma conversão pode ser atribuída ao Meta e ao Google. Não são vendas ou leads únicos somados." }));
  const columns = h("div", { class: "overview-columns" });
  columns.append(panel("Investimento no período", "Valores diários simulados por plataforma", spendChart(rows)), panel("Prioridades", "Meta configurada para este exemplo", priorityList()));
  wrap.append(columns, panel("Desempenho por campanha", `Meta de ${c.objective === "sales" ? "CPA" : "CPL"}: ${money(c.targetCpa)} · clique no nome para explorar`, campaignTable(rows)));
  return wrap;
}
function spendChart(rows: Campaign[]) {
  const chart = h("div", { class: "chart" });
  const daily = Array.from({ length: days }, (_, i) => ({ day: 28 - days + i, meta: 0, google: 0 }));
  for (const d of daily) for (const r of rows) d[r.platform] += r.daily.find(x => x.day === d.day)?.spend ?? 0;
  const max = Math.max(1, ...daily.map(d => d.meta + d.google));
  const bars = h("div", { class: "bars", role: "img", "aria-label": "Investimento diário simulado. Valores acessíveis em cada barra." });
  for (const [i, d] of daily.entries()) {
    const stack = h("div", { class: "bar-stack", tabindex: "0", title: `Dia ${i + 1}: Meta ${money(d.meta)}; Google ${money(d.google)}`, "aria-label": `Dia ${i + 1}: Meta ${money(d.meta)}; Google ${money(d.google)}` },
      h("i", { class: "bar google", style: `height:${d.google / max * 150}px` }), h("i", { class: "bar meta", style: `height:${d.meta / max * 150}px` }));
    bars.append(h("div", { class: "bar-column" }, stack, h("small", { text: String(i + 1).padStart(2, "0") })));
  }
  chart.append(bars, h("div", { class: "chart-legend" }, badge("Meta Ads", "meta"), badge("Google Ads", "google"), h("span", { text: "Dias do cenário demonstrativo" })));
  return chart;
}
function priorityList() {
  const list = h("div", { class: "priorities" });
  const pending = alerts(campaigns(), client(), days).filter(a => !reviewed.has(a.id));
  if (!pending.length) list.append(h("p", { text: "Tudo revisado neste cenário. Nenhum alerta pendente para o filtro atual." }));
  for (const a of pending.slice(0, 2)) list.append(h("div", { class: "priority" }, badge("REVISAR", "warning"), h("h3", { text: a.title }), h("p", { text: a.detail })));
  list.append(button("Abrir central de alertas →", () => { tab = "alerts"; render(); }, "button subtle"));
  return list;
}
function campaignTable(rows: Campaign[]) {
  const table = h("table");
  table.append(h("thead", {}, h("tr", {}, ...["Campanha", "Plataforma", "Investimento", "Resultados¹", "CPA / CPL", "ROAS"].map(t => h("th", { text: t, scope: "col" })))));
  const body = h("tbody");
  for (const r of rows) {
    const m = metrics(r, days);
    const cpa = ratio(m.spend, m.conversions), roas = m.revenue === null ? null : ratio(m.revenue, m.spend);
    body.append(h("tr", {}, h("td", {}, button(r.name, () => showCampaign(r), "campaign-name"), h("small", { text: `${r.channel} · ${r.status === "active" ? "Ativa" : "Pausada"}` })),
      h("td", {}, badge(PLATFORM_NAME[r.platform], r.platform)), h("td", { text: money(m.spend) }), h("td", { text: number(m.conversions) }),
      h("td", { class: cpa !== null && cpa > client().targetCpa ? "text-warning" : "", text: money(cpa) }), h("td", { text: roas === null ? "—" : `${roas.toFixed(2).replace(".", ",")}x` })));
  }
  if (!rows.length) body.append(h("tr", {}, h("td", { colspan: "6", text: "Nenhuma campanha corresponde à busca." })));
  table.append(body);
  return h("div", { class: "table-wrap" }, table, h("p", { class: "table-note", text: "¹ Resultados atribuídos à plataforma, sem deduplicação entre canais. ROAS indisponível quando não há receita." }));
}
function campaignsView() {
  const input = h("input", { type: "search", placeholder: "Buscar campanha…", "aria-label": "Buscar campanha", value: query });
  const results = h("div");
  const update = () => { clear(results); results.append(campaignTable(campaigns().filter(c => c.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))))); };
  input.addEventListener("input", () => { query = input.value; update(); });
  update();
  return panel("Todas as campanhas", "Somente leitura · exemplos fictícios", h("div", {}, h("div", { class: "search-row" }, input), results));
}
function alertsView() {
  const rows = alerts(campaigns(), client(), days);
  const list = h("div", { class: "alert-list" });
  if (!rows.length) list.append(h("div", { class: "empty" }, h("h2", { text: "Nenhum alerta neste filtro" }), h("p", { text: "A regra de demonstração exige pelo menos 10 conversões e custo por resultado acima da meta." })));
  for (const a of rows) {
    const done = reviewed.has(a.id);
    list.append(h("article", { class: `alert-card ${done ? "reviewed" : ""}` }, h("div", {}, badge(done ? "REVISADO" : "ATENÇÃO", done ? "success" : "warning"), h("h2", { text: a.title }), h("p", { text: a.detail }), h("small", { text: `Últimos ${days} dias simulados · meta ${money(client().targetCpa)} · nenhuma ação automática` })),
      h("div", { class: "alert-actions" }, button("Ver campanha", () => showCampaign(campaigns().find(c => c.id === a.campaignId)!)), button(done ? "Reabrir" : "Marcar revisado", () => { if (done) reviewed.delete(a.id); else reviewed.add(a.id); persist(); render(); }, "button primary"))));
  }
  return list;
}
function clientsView() {
  const grid = h("div", { class: "client-grid" });
  for (const c of clients) grid.append(h("article", { class: "client-card" }, badge(c.demo ? "EXEMPLO" : "CADASTRO LOCAL", c.demo ? "demo" : "success"), h("h2", { text: c.name }), h("p", { text: c.objective === "sales" ? "Objetivo: vendas" : "Objetivo: leads" }), h("dl", {}, h("dt", { text: "Orçamento mensal planejado" }), h("dd", { text: money(c.monthlyBudget) }), h("dt", { text: c.objective === "sales" ? "Meta de CPA" : "Meta de CPL" }), h("dd", { text: money(c.targetCpa) })), button(c.demo ? "Explorar exemplo →" : "Abrir cliente →", () => { selected = c.id; tab = "overview"; render(); }, "button subtle")));
  return grid;
}
function connectionsView() {
  return h("div", { class: "connection-grid" },
    panel("Meta Ads", "Conector de leitura disponível no aplicativo instalado.", button("Abrir Meta ao vivo", () => { tab = "meta"; render(); }, "button primary")),
    panel("Google Ads", "Ainda não conectado", h("p", { class: "panel-copy", text: "A configuração do projeto Google e da autorização será feita em uma próxima etapa." })));
}function dialog(title: string, body: HTMLElement) {
  const modal = h("dialog", { class: "modal", "aria-label": title });
  modal.append(h("div", { class: "modal-head" }, h("h2", { text: title }), button("Fechar", () => modal.close(), "button subtle")), body);
  modal.addEventListener("close", () => modal.remove());
  document.body.append(modal); modal.showModal();
  return modal;
}
function showCampaign(c: Campaign) {
  const m = metrics(c, days);
  const ctr = ratio(m.clicks * 100, m.impressions);
  dialog(c.name, h("div", {}, h("div", { class: "detail-tags" }, badge(PLATFORM_NAME[c.platform], c.platform), badge("DADOS DEMONSTRATIVOS", "demo")), h("p", { class: "muted", text: `Últimos ${days} dias do cenário · BRL · conta fictícia` }),
    h("div", { class: "detail-grid" }, metricCard("INVESTIMENTO", money(m.spend), "Período selecionado"), metricCard("CLIQUES", number(m.clicks), `CTR ${ctr === null ? "—" : ctr.toFixed(2).replace(".", ",") + "%"}`), metricCard("CPC", money(ratio(m.spend, m.clicks)), `${number(m.impressions)} impressões`), metricCard("RESULTADOS", number(m.conversions), "Atribuídos a esta plataforma")),
    h("div", { class: "notice", text: "Antes de decidir: confira a definição da conversão, a janela de atribuição e o atraso dos resultados. Este exemplo não representa uma campanha real." })));
}
function showClientForm() {
  const name = h("input", { required: true, maxlength: "80", placeholder: "Nome do cliente", autocomplete: "off" });
  const objective = selectControl("Objetivo", [["sales", "Vendas"], ["leads", "Leads"]], "sales", () => {});
  const budget = h("input", { type: "number", min: "0.01", max: "100000000", step: "0.01", required: true, placeholder: "5000,00" });
  const cpa = h("input", { type: "number", min: "0.01", max: "1000000", step: "0.01", required: true, placeholder: "40,00" });
  const form = h("form", { class: "client-form" }, h("p", { text: "Cadastro salvo apenas neste dispositivo. Nenhuma campanha será criada." }), h("label", {}, "Nome", name), h("label", {}, "Objetivo", objective), h("label", {}, "Orçamento mensal planejado (R$)", budget), h("label", {}, "Meta de custo por resultado (R$)", cpa), h("button", { type: "submit", class: "button primary", text: "Criar cliente" }));
  const modal = dialog("Novo cliente", form);
  form.addEventListener("submit", e => {
    e.preventDefault(); if (!name.value.trim()) { name.setCustomValidity("Informe um nome para o cliente."); name.reportValidity(); return; }
    const created: Client = { id: `local-${crypto.randomUUID()}`, name: name.value.trim(), objective: objective.value as Client["objective"], monthlyBudget: Math.round(Number(budget.value) * 100), targetCpa: Math.round(Number(cpa.value) * 100), demo: false };
    clients.push(created); selected = created.id; persist(); modal.close(); tab = "clients"; render();
  });
  name.addEventListener("input", () => name.setCustomValidity(""));
}
render();
// A normal browser can preview this page without invoking any native commands.
if (IS_TAURI) void Bridge.log("traffic prototype opened");


if (IS_TAURI) void listen("traffic-show-alerts", () => { tab = "meta"; render(); window.scrollTo(0, 0); });

