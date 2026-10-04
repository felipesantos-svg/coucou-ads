// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, type ChatContext } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
import type { ViewHost } from "./views";

let nextId = 1;

function bubble(message: ChatMessage): HTMLElement {
  if (message.role === "user") {
    return h(
      "div",
      { class: "chat-row user" },
      h("div", { class: "bubble", text: message.content }),
    );
  }
  return h("div", { class: "chat-row" }, h("div", { class: "reply", text: message.content }));
}

function typingDots(): HTMLElement {
  return h(
    "div",
    { class: "chat-row" },
    h("div", { class: "typing" }, h("i"), h("i"), h("i")),
  );
}

/** The coloured chip showing what the question is about (a dropped file). */
function contextChip(label: string): HTMLElement {
  const chip = h("div", { class: "chip" }, h("i", { class: "chip-dot" }), h("span", { text: label }));
  requestAnimationFrame(() => chip.classList.add("settled"));
  return chip;
}

export function buildPrompt(onHeightChange: () => void): ViewHost {
  const chipRow = h("div", { class: "chip-row" });
  const heading = h("div", { class: "ads-chat-heading" },
    h("strong", { text: "Claude Ads" }),
    h("span", { text: "Assistente de tráfego · Meta e Google" }),
  );
  const welcome = h("div", { class: "ads-chat-welcome", text: "Pergunte sobre uma conta ou campanha. Com o acesso Meta ligado, consulto as contas selecionadas em Meta ao vivo a cada pergunta." });
  const useMeta = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
  const period = h("select", { "aria-label": "Período da análise Meta" },
    ...[7, 14, 30].map(days => h("option", { value: days, text: `${days} dias` })),
  );
  const metaControls = h("div", { class: "ads-chat-meta" },
    h("label", {}, useMeta, " Usar contas Meta selecionadas"), period,
    h("span", { text: "Envia relatórios à Anthropic · somente leitura" }),
  );
  const access = h("div", { class: "ads-chat-access", text: "Verificando configuração da IA…" });
  void Bridge.secretPresent("anthropic-api-key").then(present => {
    access.textContent = present ? "Base Claude Ads incorporada · consulta pela API Anthropic" : "Configure a chave Anthropic na engrenagem para conversar.";
  }).catch(() => { access.textContent = "Confira a configuração da API Anthropic na engrenagem."; });
  const log = h("div", { class: "chat-log" });
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: "Pergunte o que quiser…",
    spellcheck: "false",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: "Enviar" }, svg(ICONS.arrowUp, 11));
  const bar = h("div", { class: "chat-bar" }, input, send);

  const el = h(
    "div",
    { class: "view" },
    h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, heading, access, metaControls, chipRow, welcome, log, bar)),
  );
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(99,102,241,0.5)");

  let sending = false;
  let renderedCount = -1;

  async function submit() {
    const query = input.value.trim();
    if (!query || sending) return;
    let meta: { accountIds: string[]; days: number } | null = null;
    if (useMeta.checked) {
      let ids: unknown;
      try { ids = JSON.parse(localStorage.getItem("cocou-ads.meta.selectedAccounts.v1") ?? "[]"); } catch { ids = []; }
      if (!Array.isArray(ids) || !ids.length || !ids.every(id => typeof id === "string" && /^act_\d+$/.test(id))) {
        access.textContent = "Selecione as contas em Meta ao vivo ou desligue o acesso Meta para uma dúvida geral.";
        return;
      }
      meta = { accountIds: [...new Set(ids as string[])], days: Number(period.value) };
    }
    input.value = "";
    sending = true;
    useMeta.disabled = true;
    period.disabled = true;
    access.textContent = meta ? `Consultando ${meta.accountIds.length} conta(s) Meta e preparando a análise…` : "Preparando resposta sem consulta Meta…";
    Sound.play("send");

    State.chatHistory.push({ id: nextId++, role: "user", content: query });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    const file = State.droppedFile;
    const context: ChatContext | null =
      State.chatHistory.length === 1 && file ? { kind: "file", name: file.name, path: file.path } : null;

    try {
      const reply = await Bridge.chatSend(query, context, meta);
      access.textContent = reply.metaNote ?? "Resposta sem consulta Meta nesta pergunta";
      State.chatHistory.push({ id: nextId++, role: "assistant", content: reply.text });
      State.stateOverride = null;
      Sound.play("finish");
    } catch (err) {
      // Failed requests are not retained by the native chat; allow a clean retry.
      State.chatHistory.pop();
      input.value = query;
      access.textContent = "Consulta não concluída. Tente novamente.";
      State.stateOverride = null;
      State.noteMessage = String(err).replace(/^Error:\s*/, "");
      State.view = "note";
      Sound.play("error");
    } finally {
      sending = false;
      useMeta.disabled = false;
      period.disabled = false;
      State.notify();
      onHeightChange();
      input.focus();
    }
  }

  send.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      void submit();
    }
    e.stopPropagation(); // Escape closes the island, not the chat
  });

  return {
    el,
    sync() {
      const file = State.droppedFile;
      const wantChip = file?.name ?? "";
      if (chipRow.dataset.label !== wantChip) {
        chipRow.dataset.label = wantChip;
        clear(chipRow);
        if (wantChip) chipRow.append(contextChip(wantChip));
      }

      const thinking = State.stateOverride === "thinking";
      const count = State.chatHistory.length + (thinking ? 0.5 : 0);
      if (count !== renderedCount) {
        renderedCount = count;
        clear(log);
        for (const m of State.chatHistory) log.append(bubble(m));
        if (thinking) log.append(typingDots());
        log.scrollTop = log.scrollHeight;
      }

      welcome.hidden = State.chatHistory.length > 0;
      input.placeholder = State.chatHistory.length === 0 ? "Qual sua dúvida sobre tráfego?" : "Continue a conversa…";
      input.disabled = sending;
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}
