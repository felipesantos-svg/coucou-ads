import { invoke } from "@tauri-apps/api/core";
import { h, clear } from "./dom";
import { Bridge, IS_TAURI } from "../core/bridge";
import type { ViewHost } from "./views";
import { weekRange, eventStart, eventsOnDay, upcomingEvents, type CalendarEvent } from "./calendar-model";

interface Calendar { id: string; summary?: string; primary?: boolean; selected?: boolean; hidden?: boolean }
interface Events { items?: CalendarEvent[]; hasMore: boolean; fetchedAt: number; failures?: number }

export function buildCalendar(legacy: ViewHost): ViewHost {
  const body = h("div", { class: "calendar-body" });
  const panel = h("div", { class: "card calendar-card" }, body);
  const el = h("div", { class: "view", }, panel);
  legacy.el.classList.remove("view");
  let configured = false, connected = false, initialized = false, busy = false, error = "";
  let calendars: Calendar[] = [], data: Events | null = null, nextData: Events | null = null;
  let showNextWeek = false;
  let selected = "__visible__", lastFetch = 0, showingLegacy = false, setup = false;
  const day = new Date(); day.setHours(0, 0, 0, 0);
  let observedDay = day.toDateString();
  let followToday = true;
  try { selected = localStorage.getItem("cocou-ads.calendar.scope.v2") ?? "__visible__"; } catch { /* Optional preference. */ }
  const button = (text: string, action: () => void, title?: string) => h("button", { class: "calendar-btn", text, title, disabled: busy, onclick: action });
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true; error = ""; draw();
    try { await action(); } catch (e) { error = String(e).replace(/^Error:\s*/, ""); }
    finally { busy = false; draw(); }
  }
  async function events() {
    data = null; nextData = null;
    if (!selected) return;
    const targets = selected === "__visible__" ? calendars.filter(c => !c.hidden && c.selected !== false) : calendars.filter(c => c.id === selected);
    if (!targets.length) throw new Error("Nenhuma agenda selecionada. Escolha uma agenda em Configurações.");
    const results = await Promise.allSettled([0, 1].map(async offset => {
      const { start, end } = weekRange(day, offset);
      const replies = await Promise.allSettled(targets.map(async calendar => {
        const result = await invoke<Events>("calendar_events", { calendarId: calendar.id, timeMin: start.toISOString(), timeMax: end.toISOString() });
        return { ...result, items: (result.items ?? []).map(event => ({ ...event, calendarName: calendar.summary || "Google Agenda", calendarId: calendar.id })) };
      }));
      const ok = replies.filter(r => r.status === "fulfilled");
      if (!ok.length) throw new Error("Não foi possível consultar as agendas. Tente atualizar em Configurações.");
      return { items: ok.flatMap(r => r.value.items ?? []).sort((a,b) => +eventStart(a) - +eventStart(b)),
        hasMore: ok.some(r => r.value.hasMore) || ok.length < replies.length,
        failures: replies.length - ok.length, fetchedAt: Math.min(...ok.map(r => r.value.fetchedAt)) };

    }));
    if (results[0].status === "fulfilled") data = results[0].value;
    if (results[1].status === "fulfilled") nextData = results[1].value;
    const failure = results.find(r => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    lastFetch = Date.now();
  }
  async function load() {
    const status = await invoke<{ configured: boolean; connected: boolean }>("calendar_status");
    configured = status.configured; connected = status.connected;
    if (!connected) { calendars = []; data = null; return; }
    calendars = await invoke<Calendar[]>("calendar_list");
    if (selected !== "__visible__" && !calendars.some(c => c.id === selected)) selected = "__visible__";
    await events();
  }
  function calendarControls() {
      const picker = h("select", { "aria-label": "Agenda exibida", disabled: busy });
      picker.append(h("option", { value: "__visible__", text: "Todas as agendas visíveis" }));
      for (const c of calendars) picker.append(h("option", { value: c.id, text: c.summary ?? c.id }));
      picker.value = selected;
      picker.onchange = () => { selected = picker.value; try { localStorage.setItem("cocou-ads.calendar.scope.v2", selected); } catch { /* Optional preference. */ } void run(events); };
      const date = h("input", { type: "date", "aria-label": "Dia e semana exibidos", disabled: busy });
      date.value = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,"0")}-${String(day.getDate()).padStart(2,"0")}`;
      date.onchange = () => { if (!date.value) return; const [y,m,d] = date.value.split("-").map(Number); day.setFullYear(y,m-1,d); followToday = day.toDateString() === new Date().toDateString(); void run(events); };
      return h("div", { class: "calendar-controls" }, picker, date,
        button("Hoje", () => { followToday = true; const today = new Date(); day.setFullYear(today.getFullYear(),today.getMonth(),today.getDate()); void run(events); }),
        button("↻", () => void run(load), "Atualizar compromissos"));
  }
  function draw() {
    if (showingLegacy) return;
    clear(body);
    body.append(h("div", { class: "calendar-heading" },
      h("span", { class: "alert-monitor-kicker", text: "GOOGLE AGENDA · COMPROMISSOS" }),
      button("↗", () => void Bridge.openUrl("https://calendar.google.com/"), "Abrir Google Agenda no navegador"),
    ));
    if (error) body.append(h("p", { class: "calendar-error", role: "alert", text: error }));
    if (!connected || setup) {
      const setupBody = h("div", { class: "calendar-setup" });
      if (connected) setupBody.append(calendarControls());
      setupBody.append(h("p", { text: configured ? "Conecte sua conta Google para mostrar os próximos compromissos aqui." : "Ative a Google Calendar API no Google Cloud, configure o consentimento e crie um cliente OAuth do tipo Aplicativo para computador. Importe o JSON baixado abaixo." }));
      const file = h("input", { type: "file", accept: ".json,application/json", "aria-label": "Importar configuração OAuth Desktop", disabled: busy });
      file.addEventListener("change", () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        void run(async () => {
          if (chosen.size > 32_000) throw new Error("Selecione somente o JSON de configuração OAuth Desktop.");
          await invoke("calendar_configure", { configuration: await chosen.text() });
          configured = true; connected = false; data = null; file.value = "";
        });
      });
      setupBody.append(file, h("div", { class: "calendar-actions" },
        button("Guia de configuração", () => void Bridge.openUrl("https://developers.google.com/workspace/calendar/api/quickstart/python#authorize_credentials_for_a_desktop_application")),
        configured ? button(busy ? "Aguardando Google…" : "Conectar com Google", () => void run(async () => { await invoke("calendar_connect"); setup = false; await load(); })) : null,
        connected ? button("Voltar", () => { setup = false; draw(); }) : null,
        connected ? button("Desconectar do Cocou Ads", () => void run(async () => { await invoke("calendar_disconnect"); connected = false; data = null; calendars = []; setup = false; })) : null,
      ), h("small", { text: "Login no navegador. Credenciais guardadas no Windows. Compromissos não são enviados à IA." }));
      body.append(setupBody);
    } else {
      const list = h("div", { class: "calendar-columns", "aria-live": "polite" });
      const all = upcomingEvents(data?.items ?? []);
      const daily = eventsOnDay(all, day);
      const today = day.toDateString() === new Date().toDateString();
      const weeklyData = showNextWeek ? nextData : data;
      const weeklyEvents = upcomingEvents(weeklyData?.items ?? []);
      const { start, end } = weekRange(day, showNextWeek ? 1 : 0); const last = new Date(end); last.setDate(last.getDate() - 1);
      const shortDate = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const section = (label: string, detail: string, entries: CalendarEvent[], kind: string) => {
        const column = h("section", { class: `calendar-column ${kind}` });
        const source = kind === "week" ? weeklyData : data;
        const heading = kind === "week" ? h("div", { class: "calendar-week-switch", "aria-label": "Semana exibida" },
          ...[false, true].map(next => h("button", { type: "button", text: next ? "Próxima semana" : "Esta semana", "aria-pressed": String(showNextWeek === next), onclick: () => { showNextWeek = next; draw(); } }))) : h("strong", { text: label });
        column.append(h("div", { class: "calendar-section-head" }, h("div", {}, heading, h("small", { text: detail })), h("span", { class: "alert-monitor-count", text: busy || !source ? "—" : `${entries.length}${source.hasMore ? "+" : ""}` })));
        const cards = h("div", { class: "calendar-event-list" });
        if (busy || !source || !entries.length) cards.append(h("div", { class: "calendar-empty-card", text: busy ? "Atualizando compromissos…" : !source ? "Consulta indisponível. Tente atualizar." : source.hasMore ? "Nenhum evento neste recorte parcial. Abra a agenda completa." : kind === "day" ? "Sem compromissos neste dia." : showNextWeek ? "Sem compromissos na próxima semana." : "Nenhum compromisso restante nesta semana." }));
        for (const event of entries) {
          const begins = eventStart(event);
          const now = new Date(); const until = new Date(event.end.dateTime ?? `${event.end.date}T00:00:00`);
          const ongoing = begins <= now && until > now;
          const clock = event.start.date ? "DIA INTEIRO" : begins.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
          let link = "";
          try { const url = new URL(event.htmlLink ?? ""); if (url.protocol === "https:" && ["calendar.google.com", "www.google.com"].includes(url.hostname)) link = url.href; } catch { /* No valid event link. */ }
          const card = h("button", { class: `calendar-event-card ${ongoing ? "ongoing" : ""}`, disabled: !link, title: `${event.summary || "Sem título"}\n${begins.toLocaleString("pt-BR")}\n${event.location ?? ""}`, onclick: () => { if (link) void Bridge.openUrl(link); } },
            h("span", { class: "calendar-event-meta" }, h("b", { text: clock }), h("span", { text: ongoing ? "EM ANDAMENTO" : begins.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" }) })),
            h("strong", { text: event.summary || "Compromisso sem título" }),
            h("small", { text: [event.calendarName, event.location].filter(Boolean).join(" · ") || (link ? "Ver compromisso ↗" : "Google Agenda") }));
          cards.append(card);
        }
        column.append(cards); return column;
      };
      list.append(section(today ? "Hoje" : "Dia selecionado", shortDate(day), daily, "day"), section(showNextWeek ? "Próxima semana" : "Esta semana", `${shortDate(start)} — ${shortDate(last)} · seg–dom`, weeklyEvents, "week"));
      if (data?.hasMore || weeklyData?.hasMore) list.append(h("small", { text: "Consulta parcial: alguma agenda falhou ou excedeu 100 eventos. Abra a agenda completa." }));
      body.append(list, h("small", { class: "calendar-footnote", text: `${selected === "__visible__" ? "Todas as agendas visíveis · " : ""}Horários: ${Intl.DateTimeFormat().resolvedOptions().timeZone}${data ? ` · Atualizado ${new Date(data.fetchedAt * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}` }),
        h("div", { class: "calendar-actions calendar-footer-actions" },
          button("Abrir agenda ↗", () => void Bridge.openUrl("https://calendar.google.com/")),
          button("Configurações", () => { setup = true; draw(); }),
        ));
    }
    body.append(h("button", { class: "calendar-legacy", text: "Integrações anteriores", onclick: () => {
      showingLegacy = true; panel.style.display = "none";
      el.append(legacy.el, h("button", { class: "calendar-back", text: "← Voltar à agenda", onclick: () => { showingLegacy = false; legacy.el.remove(); el.querySelector(".calendar-back")?.remove(); panel.style.display = ""; draw(); } })); legacy.sync();
    } }));
  }
  function checkNewDay() {
    const now = new Date();
    if (busy || now.toDateString() === observedDay) return;
    observedDay = now.toDateString();
    if (followToday) day.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
    if (connected && IS_TAURI) void run(events);
    else draw();
  }
  window.setInterval(checkNewDay, 30_000);
  draw();
  return { el, sync() {
    checkNewDay();
    if (showingLegacy) { legacy.sync(); return; }
    if (!initialized && IS_TAURI) { initialized = true; void run(load); }
    else if (connected && !busy && !error && !setup && lastFetch && Date.now() - lastFetch > 300_000) void run(events);
  }, tick(now) { if (showingLegacy) legacy.tick?.(now); } };
}

