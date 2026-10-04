import { alertPanel } from "../traffic/alert-panel";
// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { Ticker } from "./ticker";
import { State, type AgentTask } from "../core/state";
import { washRGBA, type IslandViewName, type Wash } from "../core/layout";
import { createMiniBot, pruneMiniBots } from "../mochi/minibots";
import { buildPrompt } from "./chat";
import { buildCalendar } from "./calendar";
import { Bridge, IS_TAURI } from "../core/bridge";
import { buildChoose, buildUpload, buildUploading } from "./upload";
import { renderIntegrationCard, type IntegrationCardHooks } from "./integrations";
import { watchSummary, showAlertCenter, type TrafficSummary } from "../core/traffic-summary";

export interface ViewActions {
  setView(v: IslandViewName): void;
  collapse(): void;
  setFocus(id: string): void;
  openTerminal(): void;
  /** The ↗ button: opens whatever the focused pill points at. */
  openTarget(): void;
  openUrl(url: string): void;
  decide(d: "allow" | "deny"): void;
  toggleSound(): void;
  setVolume(v: number): void;
  setAutoClose(seconds: number): void;
  openSettingsWindow(): void;
  blip(): void;
}

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Called when the view becomes active, for views with a text field. */
  focus?(): void;
  /** Called every frame while the view is on screen. */
  tick?(nowMs: number): void;
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function card(wash: Wash, ...children: (Node | string)[]): HTMLElement {
  const el = h("div", { class: wash ? "card wash" : "card" }, ...children);
  if (wash) el.style.setProperty("--wash", washRGBA(wash));
  return el;
}

function btn(
  label: string,
  kind: "primary" | "secondary",
  onClick: () => void,
  kbd?: string,
): HTMLElement {
  return h(
    "button",
    { class: `btn ${kind}`, onclick: onClick },
    h("span", { text: label }),
    kbd ? h("span", { class: "kbd", text: kbd }) : null,
  );
}

/** AgentWho — coloured dot + task name + grey label. */
function agentWho(task: AgentTask | null, label: string): HTMLElement {
  const row = h("div", { class: "who-row" });
  if (task) {
    row.append(dot(task.color, 8), h("span", { class: "n", text: task.name }));
  }
  row.append(h("span", { text: label }));
  return row;
}

function stack(padLeft: number, padRight: number, ...children: Node[]): HTMLElement {
  const el = h("div", { class: "stack" }, ...children);
  el.style.padding = `4px ${padRight}px 4px ${padLeft}px`;
  return el;
}

// ── Header ────────────────────────────────────────────────────────────────────

export function buildHeader(actions: ViewActions): ViewHost {
  const tabHome = h("button", { class: "tab", title: "Visão geral", onclick: () => go("overview") }, svg(ICONS.house, 13));
  const tabChat = h("button", { class: "tab", title: "Perguntar", onclick: () => go("prompt") }, svg(ICONS.bubble, 13));
  const tabDrop = h("button", { class: "tab", title: "Arquivos", onclick: () => go("upload") }, svg(ICONS.plus, 13));

  const gearBtn = h("button", { title: "Configurações", onclick: () => go("settings") }, svg(ICONS.gear, 14));
  const soundBtn = h("button", { title: "Silenciar", onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 14));
  const cardsBtn = h("button", { title: "Alternar tráfego e agenda", "aria-label": "Alternar tráfego e agenda", onclick: () => {
    showOriginal = !showOriginal;
    try { localStorage.setItem("cocou-ads.showCalendar", String(showOriginal)); } catch { /* Optional preference. */ }
    go("overview"); State.notify();
  } }, h("span", { text: "⇄" }));
  const trafficBtn = h("button", {
    title: "Gestão de tráfego · prévia", "aria-label": "Abrir gestão de tráfego",
    onclick: () => { if (IS_TAURI) void Bridge.openTrafficWindow(); else window.open("/traffic.html", "_blank", "noopener"); },
  }, svg(ICONS.arrowUpRight, 14));

  function go(v: IslandViewName) {
    actions.blip();
    actions.setView(v);
  }

  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs" }, tabHome, tabChat, tabDrop),
    h("div", { class: "header-actions" }, cardsBtn, trafficBtn, gearBtn, soundBtn),
  );

  return {
    el,
    sync() {
      const v = State.view;
      tabHome.classList.toggle("on", v === "overview" || v === "empty");
      tabChat.classList.toggle("on", v === "prompt");
      tabDrop.classList.toggle("on", v === "upload");
      gearBtn.classList.toggle("on", v === "settings");
      clear(gearBtn);
      gearBtn.append(svg(v === "settings" ? ICONS.gearFill : ICONS.gear, 14));
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 14));
      el.style.opacity = v === "confused" ? "0" : "1";
    },
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

function buildOverview(actions: ViewActions): ViewHost {
  const ticker = new Ticker();
  const who = h("div", { class: "who" });
  const tickerBody = h("div", { class: "card-body" }, who, ticker.el);
  const leftBody = h("div", { class: "left-body" });
  const jump = h(
    "button",
    { class: "icon-btn jump", title: "Abrir", onclick: () => actions.openTarget() },
    svg(ICONS.arrowUpRight, 8),
  );
  const left = card(null, leftBody, jump);
  const pills = h("div", { class: "pills" });
  const right = card(null, pills);

  const el = h("div", { class: "view overview" },
    h("div", { class: "left" }, left),
    h("div", { class: "right" }, right),
  );

  let pillIds = "";
  let detailOpen = false;
  let lastFocus: string | null = null;
  let mode: "ticker" | "card" | null = null;
  let cardKey = "";

  const hooks: IntegrationCardHooks = {
    get detailOpen() {
      return detailOpen;
    },
    openDetail() {
      detailOpen = true;
      cardKey = "";
      State.notify();
    },
    closeDetail() {
      detailOpen = false;
      cardKey = "";
      State.notify();
    },
    openSettings: () => actions.openSettingsWindow(),
  };

  return {
    el,
    tick(nowMs: number) {
      if (mode === "ticker") ticker.tick(nowMs);
    },
    sync() {
      const task = State.focusTask;
      if (task?.id !== lastFocus) {
        lastFocus = task?.id ?? null;
        detailOpen = false;
        cardKey = "";
        mode = null;
      }

      // VS Code with a live Claude Code session keeps the ticker; every other
      // pill shows its own card, exactly like IntegrationCardView.
      const sessionActive =
        task?.id === "integration_claude" && (task.state !== "idle" || task.steps.length > 0);

      if (task && sessionActive) {
        if (mode !== "ticker") {
          clear(leftBody);
          leftBody.append(tickerBody);
          mode = "ticker";
          cardKey = "";
        }
        clear(who);
        who.append(
          dot(task.color, 7),
          h("span", { class: "name", text: task.name }),
          h("span", { class: "tool", text: task.source === "claudeCode" ? "Claude Code" : "n8n" }),
        );
        if (task.steps.length > 1) {
          who.append(h("span", {
            class: "count",
            text: `${Math.min(task.stepIndex + 1, task.steps.length)}/${task.steps.length}`,
          }));
        }
        ticker.sync(task);
      } else if (task) {
        const info = State.integrations[task.id];
        const key = [
          task.id, detailOpen, task.state, task.steps.join("|"),
          info?.loaded, info?.error, info?.configured,
          JSON.stringify(info?.data ?? {}),
        ].join("~");
        if (key !== cardKey) {
          cardKey = key;
          mode = "card";
          clear(leftBody);
          leftBody.append(renderIntegrationCard(task, hooks));
        }
      }

      jump.style.display = detailOpen ? "none" : "";

      const others = State.otherTasks.slice(0, 4);
      const pillKey = others.map((t) => `${t.id}:${t.pillBadge ?? ""}`).join("|");
      if (pillKey !== pillIds) {
        pillIds = pillKey;
        clear(pills);
        for (const t of others) pills.append(buildPill(t, actions));
        pruneMiniBots();
      }
    },
  };
}

function buildPill(task: AgentTask, actions: ViewActions): HTMLElement {
  const label = task.id === "integration_claude" ? "VS Code" : task.name;
  const canvas = createMiniBot(task, 24);
  const pill = h(
    "div",
    { class: "pill", onclick: () => actions.setFocus(task.id) },
    canvas,
    h("span", { class: "lbl", text: label }),
  );
  pill.style.borderColor = `${task.color}24`;
  pill.addEventListener("mouseenter", () => {
    pill.style.background = `${task.color}2e`;
    pill.style.borderColor = `${task.color}8c`;
    pill.style.boxShadow = `0 2px 10px ${task.color}59`;
    (pill.querySelector(".lbl") as HTMLElement).style.color = lighten(task.color, 0.3);
  });
  pill.addEventListener("mouseleave", () => {
    pill.style.background = "";
    pill.style.borderColor = `${task.color}24`;
    pill.style.boxShadow = "";
    (pill.querySelector(".lbl") as HTMLElement).style.color = "";
  });

  if (task.pillBadge) {
    const colors = { approval: "#F5A524", finished: "#22C55E", error: "#F4505E" } as const;
    const icons = { approval: ICONS.bang, finished: ICONS.check, error: ICONS.xmark } as const;
    const inner = h("i", { style: `background:${colors[task.pillBadge]}` }, svg(icons[task.pillBadge], 6, { stroke: task.pillBadge === "finished" ? 3 : 0 }));
    const badge = h("div", { class: "pill-badge" }, inner);
    badge.style.boxShadow = `0 0 4px ${colors[task.pillBadge]}99`;
    pill.append(badge);
  }
  return pill;
}

function lighten(hex: string, amount: number): string {
  const v = parseInt(hex.replace("#", ""), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) =>
    Math.min(255, Math.round(x + amount * 255)),
  );
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function buildEmpty(actions: ViewActions): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px;flex-direction:row;align-items:center;gap:16px" },
    h(
      "div",
      { style: "display:flex;flex-direction:column;gap:5px" },
      h("div", { class: "title", text: "Nada em execução agora." }),
      h("div", { class: "sub", text: "Arraste um arquivo ou faça uma pergunta." }),
    ),
    h("div", { class: "grow" }),
    btn("Perguntar ao Claude", "primary", () => actions.setView("prompt")),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Approval ──────────────────────────────────────────────────────────────────

function buildApproval(actions: ViewActions): ViewHost {
  const who = h("div");
  const code = h("div", { class: "code" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("amber", stack(116, 16, who, code, row)));
  let rowKey = "";
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "precisa de permissão"));
      // The whole point of approving here rather than in the terminal: this line
      // is the command, the file path or the URL being authorised, not just the
      // name of the tool asking.
      code.textContent = State.pendingApproval?.command || State.pendingApproval?.tool || "…";
      // Two buttons, built once. Rebuilding them between a mouse-down and a
      // mouse-up would swallow the click, and there is nothing left to vary:
      // "Always" is gone until the remembered-rules list exists to back it.
      if (rowKey === "built") return;
      rowKey = "built";
      clear(row);
      row.append(
        btn("Negar", "secondary", () => actions.decide("deny"), "N"),
        btn("Permitir", "primary", () => actions.decide("allow"), "Y"),
      );
    },
  };
}

// ── Question ──────────────────────────────────────────────────────────────────

function buildQuestion(): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("cyan", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "Claude Code tem uma pergunta"));
      const task = State.focusTask;
      title.textContent = task?.steps.at(-1) ?? "Claude precisa de uma resposta.";
      clear(row);
      row.append(h("div", { class: "sub", text: "Responda no terminal. O Cocou Ads ainda não pode enviar sua resposta." }));
    },
  };
}

// ── Error ─────────────────────────────────────────────────────────────────────

function buildError(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title", text: "Fluxo interrompido." });
  const detail = h("div", { class: "detail" });
  const row = h("div", { class: "actions" },
    btn("Tentar de novo", "primary", () => actions.setView(State.defaultView())),
    btn("Abrir no n8n", "secondary", () => actions.openUrl("")),
  );
  const el = h("div", { class: "view" }, card("red", stack(116, 16, who, title, detail, row)));
  return {
    el,
    sync() {
      const task = State.focusTask;
      clear(who);
      who.append(agentWho(task, task?.source === "n8n" ? "n8n" : "Claude Code"));
      title.textContent = task?.source === "n8n" ? "Fluxo interrompido." : "Sessão interrompida por um erro.";
      detail.textContent = task?.steps.at(-1) ?? "Nenhum detalhe disponível.";
    },
  };
}

// ── Finished ──────────────────────────────────────────────────────────────────

function buildFinished(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const row = h("div", { class: "actions" },
    btn("Abrir terminal", "primary", () => actions.openTerminal()),
    btn("OK", "secondary", () => actions.collapse()),
  );
  const el = h("div", { class: "view" }, card("green", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "Claude Code concluiu"));
      title.textContent = State.focusTask?.steps.at(-1) ?? "Sessão concluída";
    },
  };
}

// ── Confused ──────────────────────────────────────────────────────────────────

function buildConfused(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 128px" },
    h("div", { class: "title", text: "Muitos toques de uma vez." }),
    h("div", { class: "sub", text: "Um instante! Volto em três segundos." }),
  );
  return { el: h("div", { class: "view" }, card("pink", body)), sync() {} };
}

// ── Note ──────────────────────────────────────────────────────────────────────

function buildNote(): ViewHost {
  const title = h("div", { class: "title" });
  const el = h("div", { class: "view" }, card(null, h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title)));
  return {
    el,
    sync() {
      title.textContent = State.noteMessage ?? "";
    },
  };
}

// ── In-island settings ────────────────────────────────────────────────────────

function buildSettings(actions: ViewActions): ViewHost {
  const soundSwitch = h("button", { class: "switch", onclick: () => actions.toggleSound() });
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    oninput: (e: Event) => actions.setVolume(Number((e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const autoLabel = h("span", {});
  const segButtons = [10, 15, 30].map((s) =>
    h("button", { onclick: () => actions.setAutoClose(s) }, `${s}s`),
  );
  const claudeBadge = h("span", { class: "status-badge" });
  const apiBadge = h("span", { class: "status-badge" });

  const rows = h(
    "div",
    { class: "settings-rows" },
    h("div", { class: "settings-row" }, soundSwitch, h("span", { text: "Som" }), volume),
    h(
      "div",
      { class: "settings-row" },
      svg(ICONS.timer, 12),
      autoLabel,
      h("div", { class: "seg" }, ...segButtons),
    ),
    h(
      "div",
      { class: "settings-row", style: "gap:14px" },
      claudeBadge,
      apiBadge,
      h("div", { class: "grow" }),
      h("button", {
        class: "link-btn",
        style: "color:#8e939c;font-size:11.5px",
        text: "Configurações…",
        onclick: () => actions.openSettingsWindow(),
      }),
    ),
  );

  const el = h("div", { class: "view" },
    card(null, h("div", { class: "stack", style: "padding:14px 16px 14px 84px" }, rows)));

  return {
    el,
    sync() {
      const s = State.settings;
      soundSwitch.classList.toggle("on", s.soundEnabled);
      volume.value = String(s.soundVolume);
      volume.style.opacity = s.soundEnabled ? "1" : "0.4";
      autoLabel.textContent = `Fechar após · ${Math.round(s.autoCloseInterval)}s`;
      segButtons.forEach((b, i) => b.classList.toggle("on", s.autoCloseInterval === [10, 15, 30][i]));
      clear(claudeBadge);
      claudeBadge.append(
        dot(s.hooksInstalled ? "#22C55E" : "#F4505E", 6),
        h("span", { text: "Claude Code" }),
      );
      clear(apiBadge);
      apiBadge.append(dot("#F4505E", 6), h("span", { text: "API" }));
    },
  };
}

// ── Placeholders filled in later stages ───────────────────────────────────────

function buildPlaceholder(title: string, sub: string): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px" },
    h("div", { class: "title", text: title }),
    h("div", { class: "sub", text: sub }),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Registry ──────────────────────────────────────────────────────────────────

let trafficSummary: TrafficSummary | null = null;
let rulesRevision = 0;
for (const event of ["storage", "traffic-rules-change"]) window.addEventListener(event, () => { rulesRevision++; State.notify(); });
let showOriginal = true;
try { showOriginal = localStorage.getItem("cocou-ads.showCalendar") !== "false"; } catch { /* Optional UI preference. */ }
void watchSummary(value => { trafficSummary = value; State.notify(); });

function withTrafficPanel(original: ViewHost): ViewHost {
  const content = h("div", { style: "padding:8px 12px 8px 90px;display:flex;flex-direction:column;gap:5px;min-width:0" });
  const panel = h("div", { style: "position:absolute;inset:0" }, card(null, content));
  original.el.classList.remove("view");
  original.el.style.position = "absolute";
  original.el.style.inset = "0";
  const el = h("div", { class: "view" }, panel, original.el);
  let last = "", selectedCampaign = "", alertMode = true;
  return { el, tick: now => { if (showOriginal) original.tick?.(now); }, sync() {
    original.el.style.display = showOriginal ? "" : "none";
    panel.style.display = showOriginal ? "none" : "";
    if (showOriginal) { original.sync(); return; }
    const key = JSON.stringify(trafficSummary) + selectedCampaign + rulesRevision + alertMode;
    if (key === last && content.childNodes.length) return;
    last = key; clear(content);
    if (alertMode) {
      content.append(alertPanel(trafficSummary, true, () => { last = ""; State.notify(); }, () => { void Bridge.openTrafficWindow().then(() => showAlertCenter()); }),
        h("button", { class: "btn secondary", style: "font-size:9px;align-self:flex-start", text: "Ver métricas anteriores", onclick: () => { alertMode = false; last = ""; State.notify(); } }));
      return;
    }
    content.append(h("button", { class: "btn secondary", style: "font-size:9px;align-self:flex-start", text: "Voltar aos alertas", onclick: () => { alertMode = true; last = ""; State.notify(); } }));
    const data = trafficSummary;
    const entries = data?.entries ?? [];
    const current = entries.find(e => e.id === selectedCampaign) ?? entries[0];
    if (current && data) {
      selectedCampaign = current.id;
      const controlStyle = "background:#171b20;color:#fff;border:1px solid #353b42;border-radius:5px;min-width:0;font-size:11px;padding:2px;max-width:100%";
      const accountSelect = h("select", { "aria-label": "Conta do painel compacto", style: controlStyle });
      // Account identity comes from the compound account/campaign identifier.
      const accountId = current.id.split("/")[0];
      const uniqueAccounts = new Map(entries.map(e => [e.id.split("/")[0], e.account]));
      for (const [id, name] of uniqueAccounts) accountSelect.append(h("option", { value: id, text: name }));
      accountSelect.value = accountId;
      accountSelect.onchange = () => { selectedCampaign = entries.find(e => e.id.split("/")[0] === accountSelect.value)!.id; last = ""; State.notify(); };
      const campaignSelect = h("select", { "aria-label": "Campanha do painel compacto", style: controlStyle });
      for (const e of entries.filter(e => e.id.split("/")[0] === accountId)) campaignSelect.append(h("option", { value: e.id, text: `${e.objective} · ${e.campaign} · ${e.status}` }));
      campaignSelect.value = current.id;
      campaignSelect.onchange = () => { selectedCampaign = campaignSelect.value; last = ""; State.notify(); };
      content.append(h("div", { style: "display:flex;gap:5px;min-width:0" }, accountSelect, campaignSelect));
      const money = current.spend === null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: current.currency }).format(current.spend);
      content.append(h("strong", { style: "font-size:11px", text: `${current.objective} · ${current.status}` }),
        h("span", { style: "font-size:11px", text: current.spend === null ? "Sem atividade retornada para esta campanha no período" : `${money} investidos · ${current.clicks?.toLocaleString("pt-BR")} cliques · ${current.impressions?.toLocaleString("pt-BR")} impressões` }),
        h("small", { style: "font-size:9px;opacity:.6", text: `${data.days} dias · ${new Date(current.fetchedAt * 1000).toLocaleString("pt-BR")}${data.account.includes("PARCIAL") ? " · consulta parcial" : ""}` }));
    } else content.append(h("strong", { style: "font-size:12px", text: "Meta · campanhas separadas" }), h("span", { style: "font-size:11px;opacity:.65", text: data ? "Nenhuma campanha ativa ou com atividade retornada. Confira as contas no painel." : "Aguardando consulta autorizada. Abra o painel para conferir o acesso." }));    content.append(h("button", { class: "btn secondary", style: "align-self:flex-start;font-size:10px", text: "Abrir contas e campanhas ↗", onclick: () => { void Bridge.openTrafficWindow(); } }));
  } };
}

export function buildViews(
  actions: ViewActions,
  onChatHeightChange: () => void,
): Map<IslandViewName, ViewHost> {
  const map = new Map<IslandViewName, ViewHost>();
  map.set("overview", withTrafficPanel(buildCalendar(buildOverview(actions))));
  map.set("empty", withTrafficPanel(buildCalendar(buildEmpty(actions))));
  map.set("approval", buildApproval(actions));
  map.set("question", buildQuestion());
  map.set("error", buildError(actions));
  map.set("finished", buildFinished(actions));
  map.set("confused", buildConfused());
  map.set("note", buildNote());
  map.set("settings", buildSettings(actions));
  map.set("prompt", buildPrompt(onChatHeightChange));
  map.set("upload", buildUpload());
  map.set("uploading", buildUploading());
  map.set("choose", buildChoose(actions));
  // Not in the Windows v1: sending a file by email, window attach + web result.
  map.set("mail", buildPlaceholder("O envio por e-mail não está disponível nesta versão.", ""));
  map.set("searching", buildPlaceholder("Claude está pesquisando…", ""));
  map.set("result", buildPlaceholder("Resultado", ""));
  return map;
}



