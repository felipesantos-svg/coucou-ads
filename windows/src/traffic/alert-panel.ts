import { h } from "../views/dom";
import { evaluateRule, parseRequest, type Rule } from "./alert-model";
import type { TrafficSummary } from "../core/traffic-summary";
const KEY = "cocou-ads.traffic.alertRules.v1";
export function readRules(): Rule[] {
  try { const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[{"id":"requested-roas","metric":"roas","threshold":5,"minImpressions":1000,"accountId":""},{"id":"requested-ctr","metric":"ctr","threshold":1,"minImpressions":1000,"accountId":""}]'); return Array.isArray(v) ? v.filter((r): r is Rule => !!r && typeof r.id === "string" && ["ctr", "roas", "message"].includes(r.metric) && Number.isFinite(r.threshold) && r.threshold > 0 && Number.isFinite(r.minImpressions) && r.minImpressions >= 0 && typeof r.accountId === "string") : []; } catch { return []; }
}
export function alertPanel(data: TrafficSummary | null, compact: boolean, refresh: () => void, open: () => void) {
  const metricName = (r: Rule) => r.metric === "message" ? "CUSTO POR MENSAGEM ALTO" : `${r.metric.toUpperCase()} BAIXO`;
  const unit = (r: Rule) => r.metric === "ctr" ? "%" : r.metric === "roas" ? "x" : " na moeda da conta";
  const rules = readRules(), entries = data?.entries ?? [];
  const hits = entries.flatMap(entry => rules.map(rule => ({ entry, rule, result: evaluateRule(entry, rule) }))).filter(x => x.result.state === "alert");
  const missing = entries.flatMap(entry => rules.map(rule => evaluateRule(entry, rule))).filter(r => ["stale", "insufficient", "unavailable"].includes(r.state)).length;
  const box = h("section", { class: compact ? "alert-monitor" : "panel panel-copy" });
  if (compact) {
    box.append(h("div", { class: "alert-monitor-head" }, h("div", {}, h("span", { class: "alert-monitor-kicker", text: "META ADS · MONITOR" }), h("strong", { text: "Atenção às campanhas" })), h("span", { class: "alert-monitor-count", text: String(hits.length), "aria-label": `${hits.length} alertas` })));
    const list = h("div", { class: "alert-monitor-grid", "aria-label": "Alertas por campanha" });
    for (const { entry, rule, result } of hits) {
      const value = result.value?.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) ?? "—";
      list.append(h("button", { class: `alert-monitor-item ${rule.metric}`, title: `${entry.account}\n${entry.campaign}\n${metricName(rule)}: ${value}${unit(rule)}; limite ${rule.threshold}${unit(rule)}`, onclick: open },
        h("span", { class: "alert-monitor-metric" }, h("span", { text: rule.metric === "message" ? "CUSTO / MENSAGEM" : `${rule.metric.toUpperCase()} BAIXO` }), h("b", { text: `${value}${rule.metric === "ctr" ? "%" : rule.metric === "roas" ? "x" : ""}` })),
        h("strong", { class: "alert-monitor-account", text: entry.account }), h("span", { class: "alert-monitor-campaign", text: entry.campaign })));
    }
    if (!hits.length) list.append(h("div", { class: "alert-monitor-empty", text: !rules.length ? "Crie sua primeira regra para acompanhar campanhas." : !data ? "Consultando suas campanhas…" : missing ? "Dados insuficientes para concluir todas as avaliações." : "Nenhum alerta nas regras configuradas." }));
    const detail = !data ? "Aguardando dados" : `${data.days} dias · consulta ${new Date(data.fetchedAt * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}${data.account.includes("PARCIAL") ? " · parcial" : ""}`;
    box.append(list, h("div", { class: "alert-monitor-footer" }, h("span", { text: detail }), h("button", { class: "alert-monitor-open", text: "Revisar alertas ↗", onclick: open })));
    return box;
  }
  box.append(h("strong", { text: `Campanhas precisam de atenção · ${hits.length} alertas` }));  box.append(h("p", { text: "Regras locais sobre a última consulta. Não há monitoramento contínuo nem alterações automáticas. CTR usa todos os cliques; ROAS usa compras no site atribuídas pelo Meta, apenas em campanhas de vendas. Custo por mensagem usa conversas iniciadas em 7 dias atribuídas pelo Meta (spend / messaging_conversation_started_7d), não total de mensagens. O mínimo inicial de 1.000 impressões é ajustável. Dados com mais de 24 horas não geram alertas." }));
  const input = h("input", { placeholder: "Ex.: CTR abaixo de 1%, ROAS abaixo de 5 ou custo por mensagem acima de 10", "aria-label": "Pedido de alerta", required: true });
  const minimum = h("input", { type: "number", min: "0", step: "1", value: "1000", required: true, "aria-label": "Mínimo de impressões" });
  const account = h("select", { "aria-label": "Conta da regra" }, h("option", { value: "", text: "Todas as contas selecionadas" }));
  for (const [id, name] of new Map(entries.map(e => [e.id.split("/")[0], e.account]))) account.append(h("option", { value: id, text: name }));
  const error = h("p", { role: "status" });
  const form = h("form", { class: "client-form" }, h("label", {}, "O que acompanhar", input), h("label", {}, "Mínimo de impressões para avaliar (ajustável)", minimum), h("label", {}, "Aplicar a", account), h("button", { class: "button primary", type: "submit", text: "Criar alerta" }), error);
  const save = (next: Rule[]) => { try { localStorage.setItem(KEY, JSON.stringify(next)); window.dispatchEvent(new Event("traffic-rules-change")); refresh(); } catch { error.textContent = "Não foi possível salvar a regra."; } };
  form.onsubmit = event => { event.preventDefault(); const parsed = parseRequest(input.value); if (!parsed) { error.textContent = "Informe métrica e limite, como CTR abaixo de 1%, ROAS abaixo de 5 ou custo por mensagem acima de 10. Os exemplos não são metas recomendadas."; return; } if (parsed.metric === "message" && !account.value) { error.textContent = "Selecione uma conta para definir o custo por mensagem na moeda dela."; return; } const min = Number(minimum.value); if (!Number.isSafeInteger(min) || min < 0) return; save([...rules, { ...parsed, id: crypto.randomUUID(), minImpressions: min, accountId: account.value }]); };
  box.append(form);
  for (const rule of rules) box.append(h("p", {}, `${metricName(rule)} ${rule.metric === "message" ? ">" : "<"} ${rule.threshold}${unit(rule)} · mínimo ${rule.minImpressions} impressões · ${rule.accountId || "contas selecionadas"} `, h("button", { class: "button", text: "Remover regra", onclick: () => save(rules.filter(r => r.id !== rule.id)) })));
  if (!data) box.append(h("p", { text: "Aguardando dados reais das contas selecionadas." }));
  if (data?.account.includes("PARCIAL")) box.append(h("p", { role: "status", text: "Consulta parcial: algumas contas não foram avaliadas." }));
  if (missing) box.append(h("p", { text: `${missing} avaliações não concluídas: amostra insuficiente, dados antigos ou métrica indisponível. Isso não significa desempenho bom ou ruim.` }));
  for (const { entry, rule, result } of hits) box.append(h("article", { class: "alert-card" }, h("div", {}, h("h3", { text: `${metricName(rule)} · ${entry.account}` }), h("p", { text: `${entry.campaign} · ${entry.objective}` }), h("p", { text: `Valor ${result.value?.toFixed(2)}${unit(rule)} ${rule.metric === "message" ? "acima" : "abaixo"} do limite ${rule.threshold}. ${entry.impressions} impressões · período de ${data?.days} dias · consulta ${new Date(entry.fetchedAt * 1000).toLocaleString("pt-BR")}. Revise a campanha antes de decidir.` }))));
  return box;
}


