import { invoke } from "@tauri-apps/api/core";
import { IS_TAURI } from "../core/bridge";
import { h } from "./dom";

interface Quota { id: string; label: string; used: number | null; resets_at: number | null; derived: boolean; group: string | null }
interface Meter { provider: string; message?: string | null; snapshot: { status: string; fetched_at: number; windows: Quota[] } | null }
const providers = [
  { id: "claude", name: "Claude", icon: "claude.svg", color: "#e3a47e" },
  { id: "codex", name: "OpenAI / Codex", icon: "codex.svg", color: "#a4e8cf" },
  { id: "antigravity", name: "Antigravity", icon: "antigravity.svg", color: "#aab6ff" },
];

export function buildUsageMeter(): HTMLElement {
  const el = h("div", { id: "usage-meters", "aria-label": "Consumo dos limites de IA consultado pelo Cocou Ads" });
  const mark = (icon: string) => h("i", { class: "usage-provider-icon", "aria-hidden": "true", style: `mask-image:url(/provider-icons/${icon});-webkit-mask-image:url(/provider-icons/${icon})` });
  let meters: Meter[] = [];
  function draw() {
    el.replaceChildren(...providers.map(provider => {
      const meter = meters.find(m => m.provider === provider.id);
      const snapshot = meter?.snapshot;
      const windows = snapshot?.windows ?? [];
      // Core Codex primary only: never substitute weekly/Spark/review quotas.
      const primary = provider.id === "claude" ? windows.find(w => w.id === "session")
        : provider.id === "codex" ? windows.find(w => w.id === "primary")
        : windows.find(w => w.used !== null);
      const value = primary?.used;
      const available = typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
      const stale = !!snapshot && (snapshot.status !== "ok" || !snapshot.fetched_at || Date.now() - snapshot.fetched_at > 900_000 || snapshot.fetched_at > Date.now() + 60_000);
      const percent = available ? `${Math.round(value * 100)}%` : "—";
      const tooltipId = `quota-tooltip-${provider.id}`;
      const tooltip = h("div", { class: "usage-tooltip", id: tooltipId, role: "tooltip" },
        h("strong", { class: "usage-tooltip-title" }, mark(provider.icon), `Uso ${provider.id === "claude" ? "do" : "de"} ${provider.name}`));
      if (!snapshot) tooltip.append(h("p", { text: meter?.message || "Consultando limites pelo Cocou Ads…" }));
      else {
        if (stale) tooltip.append(h("p", { class: "usage-tooltip-warning", text: meter?.message || "Leitura antiga · aguardando atualização" }));
        const labels: Record<string, string> = { session: "Sessão atual", primary: "Sessão atual", secondary: "Semanal", weekly_all: "Semanal (todos os modelos)", "Weekly Limit": "Limite semanal", "5h limit": "Limite de 5 horas" };
        for (const w of windows.slice(0, 4)) {
          const used = w.used === null ? null : Math.round(w.used * 100);
          const reset = w.resets_at ? new Date(w.resets_at) : null;
          const sameDay = reset?.toDateString() === new Date().toDateString();
          const renewal = reset ? `Renova ${sameDay ? "às " : reset.toLocaleDateString("pt-BR", { weekday: "short" }) + " "}${reset.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "";
          const label = labels[w.id] ?? labels[w.label] ?? w.label;
          const color = used !== null && used >= 90 ? "#ff7785" : used !== null && used >= 50 ? "#e5da48" : "#36d99b";
          tooltip.append(h("div", { class: "usage-tooltip-window" },
            w.group ? h("small", { class: "usage-tooltip-group", text: w.group }) : null,
            h("div", { class: "usage-tooltip-row" }, h("b", { text: label }), h("span", { text: renewal })),
            h("div", { class: "usage-tooltip-track" }, h("i", { style: `width:${used ?? 0}%;background:${color}` })),
            h("small", { text: used === null ? "Consumo indisponível" : `${used}% usado · ${100 - used}% livre${w.derived ? " · estimativa" : ""}` })));
        }
        if (!windows.length) tooltip.append(h("p", { text: "Limites indisponíveis nesta leitura." }));
        if (windows.length > 4) tooltip.append(h("small", { text: `Mais ${windows.length - 4} limites disponíveis.` }));
        tooltip.append(h("small", { class: "usage-tooltip-source", text: `Cocou Ads · ${new Date(snapshot.fetched_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` }));
      }
      const color = available && value >= .9 ? "#ff7d88" : available && value >= .7 ? "#f2c367" : provider.color;
      return h("span", { class: `usage-meter${stale ? " stale" : ""}`, "aria-describedby": tooltipId, "aria-label": `${provider.name}: ${percent}${stale ? ", leitura antiga" : ""}` },
        h("span", { class: "usage-ring", style: `--usage:${available ? value * 100 : 0}%;--quota-color:${color}` }, h("span", {}, mark(provider.icon))),
        h("b", { text: `${stale ? "~" : ""}${percent}` }), tooltip);
    }));
  }
  let refreshing = false;
  async function refresh() {
    if (!IS_TAURI || refreshing) return;
    refreshing = true;
    try { meters = await invoke<Meter[]>("usage_meter"); }
    catch { meters = providers.map(p => ({ provider: p.id, snapshot: null, message: "Consulta indisponível. Tente novamente em instantes." })); }
    finally { refreshing = false; }
    draw();
  }
  draw();
  void refresh();
  window.setInterval(() => void refresh(), 30_000);
  return el;
}
