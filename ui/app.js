"use strict";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const el = {
  app: $("app"), main: $("main"), sessions: $("sessions"), thread: $("thread"),
  threadWrap: $("thread-wrap"), chatTitle: $("chat-title"), composer: $("composer"),
  input: $("input"), send: $("send"), stop: $("stop"), notice: $("notice"),
  modelBtn: $("model-btn"), modelLabel: $("model-label"), modelMenu: $("model-menu"),
  modelSearch: $("model-search"), modelList: $("model-list"),
  status: $("status"), statusText: $("status-text"),
  providersDialog: $("providers-dialog"), providerSearch: $("provider-search"), providerList: $("provider-list"),
};

const MODEL_KEY = "openchat.model";
const FEATURED_PROVIDERS = ["deepseek", "moonshotai", "openrouter", "groq", "zai", "alibaba", "ollama-cloud", "opencode-go", "togetherai", "fireworks-ai", "mistral"];

const state = {
  ready: false,
  models: [],
  model: null,            // { id, providerID }
  sessions: [],
  sessionId: null,
  messages: [],
  busy: new Set(),        // sesiones con una respuesta en curso
  live: null,             // respuesta que se está recibiendo: { messageId, parts[], node }
  integrations: [],
  openProvider: null,
};

const htmlCache = new Map();
let threadVersion = 0;

/* ---------- utilidades ---------- */

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function icon(path) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

async function markdown(text) {
  if (htmlCache.has(text)) return htmlCache.get(text);
  const html = await invoke("render_markdown", { text });
  if (htmlCache.size > 400) htmlCache.clear();
  htmlCache.set(text, html);
  return html;
}

function showNotice(message) {
  el.notice.textContent = message;
  el.notice.hidden = !message;
}

function errorText(error) {
  return typeof error === "string" ? error : error?.message || String(error);
}

function formatWait(ms) {
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function sameModel(a, b) {
  return !!a && !!b && a.id === b.id && a.providerID === b.providerID;
}

function nearBottom() {
  const w = el.threadWrap;
  return w.scrollHeight - w.scrollTop - w.clientHeight < 120;
}

function scrollToBottom() {
  el.threadWrap.scrollTop = el.threadWrap.scrollHeight;
}

/* ---------- modelos ---------- */

async function loadModels() {
  const { models, default: fallback } = await invoke("list_models");
  state.models = models;

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(MODEL_KEY)); } catch { /* preferencia ilegible: se ignora */ }
  const known = (m) => m && models.some((x) => sameModel(x, m));
  if (!known(state.model)) {
    state.model = known(saved) ? saved : known(fallback) ? fallback : models[0] ? { id: models[0].id, providerID: models[0].providerID } : null;
  }
  renderModelButton();
  if (!el.modelMenu.hidden) renderModelList();
}

function renderModelButton() {
  const current = state.models.find((m) => sameModel(m, state.model));
  el.modelLabel.textContent = current ? current.name : "Sin modelos disponibles";
  updateSendState();
}

function renderModelList() {
  const term = el.modelSearch.value.trim().toLowerCase();
  const matches = state.models.filter((m) => !term || `${m.name} ${m.providerName} ${m.id}`.toLowerCase().includes(term));
  el.modelList.replaceChildren();
  if (!matches.length) {
    el.modelList.append(node("div", "model-empty", state.models.length ? "Ningún modelo coincide." : "No hay modelos. Conecta un proveedor."));
    return;
  }
  const groups = new Map();
  for (const m of matches) {
    if (!groups.has(m.providerName)) groups.set(m.providerName, []);
    groups.get(m.providerName).push(m);
  }
  for (const [provider, items] of groups) {
    el.modelList.append(node("div", "model-group", provider));
    for (const m of items) {
      const option = node("button", "model-option", m.name);
      option.type = "button";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(sameModel(m, state.model)));
      option.addEventListener("click", () => chooseModel({ id: m.id, providerID: m.providerID }));
      el.modelList.append(option);
    }
  }
}

function toggleModelMenu(open) {
  el.modelMenu.hidden = !open;
  el.modelBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    el.modelSearch.value = "";
    renderModelList();
    el.modelSearch.focus();
  }
}

async function chooseModel(model) {
  state.model = model;
  localStorage.setItem(MODEL_KEY, JSON.stringify(model));
  toggleModelMenu(false);
  renderModelButton();
  el.input.focus();
  if (state.sessionId) {
    try {
      await invoke("set_session_model", { sessionId: state.sessionId, model });
      showNotice("");
    } catch (error) {
      showNotice(`No se pudo cambiar el modelo: ${errorText(error)}`);
    }
  }
}

/* ---------- lista de chats ---------- */

async function loadSessions() {
  state.sessions = (await invoke("list_sessions")) || [];
  renderSessions();
}

function sessionTitle(session) {
  return session?.title?.trim() || "Nuevo chat";
}

function renderSessions() {
  const sorted = [...state.sessions].sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0));
  el.sessions.replaceChildren();
  if (!sorted.length) {
    el.sessions.append(node("div", "sessions-empty", "Aún no hay chats."));
  }
  for (const session of sorted) {
    const row = node("div", "session" + (session.id === state.sessionId ? " active" : ""));
    const title = node("button", "session-title", sessionTitle(session));
    title.type = "button";
    title.title = sessionTitle(session);
    title.addEventListener("click", () => openSession(session.id));
    row.append(title);
    if (state.busy.has(session.id)) row.append(node("span", "busy-dot"));

    const remove = node("button", "session-delete");
    remove.type = "button";
    remove.title = "Eliminar chat";
    remove.setAttribute("aria-label", `Eliminar chat ${sessionTitle(session)}`);
    remove.append(icon("M5 6h10M8 6V4h4v2M7 6l.6 10h4.8L13 6"));
    remove.addEventListener("click", () => removeSession(session));
    row.append(remove);
    el.sessions.append(row);
  }
  const current = state.sessions.find((s) => s.id === state.sessionId);
  el.chatTitle.textContent = current ? sessionTitle(current) : "";
}

async function removeSession(session) {
  if (!window.confirm(`¿Eliminar el chat "${sessionTitle(session)}"? No se puede deshacer.`)) return;
  try {
    await invoke("delete_session", { sessionId: session.id });
    state.sessions = state.sessions.filter((s) => s.id !== session.id);
    state.busy.delete(session.id);
    if (state.sessionId === session.id) newChat();
    else renderSessions();
  } catch (error) {
    showNotice(`No se pudo eliminar: ${errorText(error)}`);
  }
}

function newChat() {
  state.sessionId = null;
  state.messages = [];
  state.live = null;
  showNotice("");
  renderSessions();
  renderThread();
  updateSendState();
  el.input.focus();
}

async function openSession(id) {
  if (state.sessionId === id) return;
  state.sessionId = id;
  state.messages = [];
  state.live = null;
  showNotice("");
  renderSessions();
  updateSendState();

  const session = state.sessions.find((s) => s.id === id);
  if (session?.model && state.models.some((m) => sameModel(m, session.model))) {
    state.model = { id: session.model.id, providerID: session.model.providerID };
    renderModelButton();
  }
  await reloadMessages(true);
  el.input.focus();
}

/* ---------- conversación ---------- */

async function reloadMessages(jumpToEnd = false) {
  const id = state.sessionId;
  if (!id) return;
  try {
    const messages = await invoke("list_messages", { sessionId: id });
    if (state.sessionId !== id) return; // el usuario cambió de chat mientras cargaba
    state.messages = messages || [];
    await renderThread(jumpToEnd);
  } catch (error) {
    showNotice(`No se pudieron cargar los mensajes: ${errorText(error)}`);
  }
}

// `error` llega ya traducido por el motor: { kind, message, detail?, retryAfterMs? }.
function errorBlock(error) {
  const box = node("div", "msg-error", error?.message || "El modelo devolvió un error.");
  box.dataset.kind = error?.kind || "unknown";
  if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0) {
    box.append(node("small", "", `Vuelve a estar disponible en unos ${formatWait(error.retryAfterMs)}.`));
  }
  if (error?.detail) {
    const detail = node("details", "error-detail");
    detail.append(node("summary", "", "Detalle del proveedor"), node("div", "", error.detail));
    box.append(detail);
  }
  return box;
}

function reasoningBlock(text, open) {
  const details = node("details", "reasoning");
  details.open = open;
  details.append(node("summary", "", "Razonamiento"), node("div", "reasoning-body", text));
  return details;
}

function decorateProse(prose) {
  for (const pre of prose.querySelectorAll("pre")) {
    const copy = node("button", "copy-code", "Copiar");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(pre.querySelector("code")?.textContent ?? "");
      copy.textContent = "Copiado";
      setTimeout(() => (copy.textContent = "Copiar"), 1400);
    });
    pre.append(copy);
  }
}

async function proseBlock(text) {
  const prose = node("div", "prose");
  prose.innerHTML = await markdown(text); // HTML saneado en Rust (ammonia)
  decorateProse(prose);
  return prose;
}

function modelName(ref) {
  const model = state.models.find((m) => sameModel(m, ref));
  return model ? model.name : ref?.id || "";
}

async function assistantNode(message) {
  const box = node("div", "msg assistant");
  const texts = [];
  for (const part of message.content || []) {
    if (part.type === "text" && part.text) {
      texts.push(part.text);
      box.append(await proseBlock(part.text));
    } else if (part.type === "reasoning" && part.text) {
      box.append(reasoningBlock(part.text, false));
    } else if (part.type === "tool") {
      const blocked = part.state?.status === "error";
      box.append(node("span", "tool-chip", `Herramienta ${part.name}${blocked ? " · no permitida" : ""}`));
    }
  }
  if (message.error && message.error.kind !== "aborted") box.append(errorBlock(message.error));

  if (texts.length) {
    const actions = node("div", "msg-actions");
    const copy = node("button");
    copy.type = "button";
    copy.title = "Copiar respuesta";
    copy.setAttribute("aria-label", "Copiar respuesta");
    copy.append(icon("M7 7V4h9v9h-3M4 7h9v9H4z"));
    copy.addEventListener("click", () => navigator.clipboard.writeText(texts.join("\n\n")));
    actions.append(copy, node("span", "msg-model", modelName(message.model)));
    box.append(actions);
  }
  return box.childNodes.length ? box : null;
}

async function renderThread(jumpToEnd = false) {
  const version = ++threadVersion;
  const stick = jumpToEnd || nearBottom();
  const nodes = [];
  for (const message of state.messages) {
    if (message.type === "user") {
      nodes.push(node("div", "msg user", message.text));
    } else if (message.type === "assistant") {
      const rendered = await assistantNode(message);
      if (rendered) nodes.push(rendered);
    }
  }
  if (version !== threadVersion) return; // llegó un render más nuevo mientras se convertía el markdown

  const waiting = state.busy.has(state.sessionId) && !state.live;
  if (state.live) nodes.push(state.live.node);
  if (waiting) nodes.push(typingNode());

  el.thread.replaceChildren(...nodes);
  el.main.classList.toggle("empty", !state.sessionId && !nodes.length);
  if (stick) scrollToBottom();
}

function typingNode() {
  const box = node("div", "msg assistant");
  const dots = node("div", "typing");
  dots.setAttribute("aria-label", "El modelo está respondiendo");
  dots.append(node("span"), node("span"), node("span"));
  box.append(dots);
  return box;
}

/* ---------- respuesta en curso ---------- */

function liveResponse(messageId) {
  if (state.live?.messageId === messageId) return state.live;
  state.live = { messageId, parts: [], node: node("div", "msg assistant"), timer: null, paint: 0 };
  renderThread();
  return state.live;
}

function livePart(live, type, ordinal) {
  let part = live.parts.find((p) => p.type === type && p.ordinal === ordinal);
  if (!part) {
    part = { type, ordinal, text: "", node: null };
    live.parts.push(part);
  }
  return part;
}

function scheduleLivePaint(live) {
  if (live.timer) return;
  live.timer = setTimeout(() => {
    live.timer = null;
    paintLive(live);
  }, 70);
}

async function paintLive(live) {
  const paint = ++live.paint;
  const stick = nearBottom();
  for (const part of live.parts) {
    if (part.type === "text") {
      const html = await markdown(part.text);
      if (paint !== live.paint || state.live !== live) return;
      if (!part.node) { part.node = node("div", "prose"); live.node.append(part.node); }
      part.node.innerHTML = html;
      decorateProse(part.node);
    } else {
      if (!part.node) { part.node = reasoningBlock("", true); live.node.append(part.node); }
      part.node.querySelector(".reasoning-body").textContent = part.text;
    }
  }
  if (stick) scrollToBottom();
}

async function finishExecution(sessionId) {
  state.busy.delete(sessionId);
  if (sessionId === state.sessionId) {
    state.live = null;
    await reloadMessages();
    updateSendState();
  }
  renderSessions();
}

function handleEvent(event) {
  const type = event.type;
  const data = event.data || {};
  const sessionId = data.sessionID;

  if (type === "model.updated" || type === "provider.updated" || type === "integration.updated") {
    clearTimeout(handleEvent.modelsTimer);
    handleEvent.modelsTimer = setTimeout(() => loadModels().catch(() => {}), 400);
    return;
  }
  if (!sessionId) return;
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return; // sesión ajena a OpenChat

  switch (type) {
    case "session.renamed":
      session.title = data.title;
      renderSessions();
      return;
    case "session.deleted":
      state.sessions = state.sessions.filter((s) => s.id !== sessionId);
      if (state.sessionId === sessionId) newChat(); else renderSessions();
      return;
    case "session.execution.started":
      state.busy.add(sessionId);
      session.time = { ...session.time, updated: Date.now() };
      renderSessions();
      if (sessionId === state.sessionId) updateSendState();
      return;
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
      finishExecution(sessionId);
      return;
  }

  if (sessionId !== state.sessionId) return;
  if (type === "session.text.delta" || type === "session.reasoning.delta") {
    const live = liveResponse(data.assistantMessageID);
    const part = livePart(live, type === "session.text.delta" ? "text" : "reasoning", data.ordinal);
    part.text += data.delta;
    scheduleLivePaint(live);
  } else if (type === "session.text.ended" || type === "session.reasoning.ended") {
    const live = liveResponse(data.assistantMessageID);
    livePart(live, type === "session.text.ended" ? "text" : "reasoning", data.ordinal).text = data.text;
    scheduleLivePaint(live);
  }
}

/* ---------- envío ---------- */

function updateSendState() {
  const busy = state.busy.has(state.sessionId);
  el.send.hidden = busy;
  el.stop.hidden = !busy;
  el.send.disabled = !state.ready || !state.model || !el.input.value.trim();
}

function autoGrow() {
  el.input.style.height = "auto";
  el.input.style.height = `${el.input.scrollHeight}px`;
}

async function send() {
  const text = el.input.value.trim();
  if (!text || !state.ready || !state.model || state.busy.has(state.sessionId)) return;
  showNotice("");

  try {
    if (!state.sessionId) {
      const title = text.replace(/\s+/g, " ").slice(0, 60);
      const session = await invoke("create_session", { title, model: state.model });
      state.sessions.unshift(session);
      state.sessionId = session.id;
    }
    const sessionId = state.sessionId;
    el.input.value = "";
    autoGrow();
    state.messages.push({ type: "user", text });
    state.busy.add(sessionId);
    renderSessions();
    updateSendState();
    await renderThread(true);
    await invoke("send_prompt", { sessionId, text });
  } catch (error) {
    state.busy.delete(state.sessionId);
    updateSendState();
    renderSessions();
    renderThread();
    showNotice(`No se pudo enviar: ${errorText(error)}`);
    if (!el.input.value) { el.input.value = text; autoGrow(); updateSendState(); }
  }
}

async function stop() {
  if (!state.sessionId) return;
  try {
    await invoke("interrupt_session", { sessionId: state.sessionId });
  } catch (error) {
    showNotice(`No se pudo detener: ${errorText(error)}`);
  }
}

/* ---------- proveedores ---------- */

async function openProviders() {
  el.providerSearch.value = "";
  state.openProvider = null;
  el.providerList.replaceChildren(node("div", "model-empty", "Cargando…"));
  el.providersDialog.showModal();
  await loadIntegrations();
}

async function loadIntegrations() {
  try {
    state.integrations = await invoke("list_integrations");
    renderProviders();
  } catch (error) {
    el.providerList.replaceChildren(node("div", "provider-error", errorText(error)));
  }
}

function renderProviders(failure) {
  const term = el.providerSearch.value.trim().toLowerCase();
  const rank = (p) => (p.connected ? 0 : FEATURED_PROVIDERS.includes(p.id) ? 1 + FEATURED_PROVIDERS.indexOf(p.id) : 100);
  const items = state.integrations
    .filter((p) => !term || `${p.name} ${p.id}`.toLowerCase().includes(term))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  el.providerList.replaceChildren();
  if (!items.length) el.providerList.append(node("div", "model-empty", "Ningún proveedor coincide."));

  for (const provider of items) {
    const box = node("div", "provider");
    const row = node("div", "provider-row");
    row.append(node("span", "provider-name", provider.name));
    if (provider.connected) row.append(node("span", "provider-state", "Conectado"));
    const toggle = node("button", "button", provider.connected ? "Cambiar clave" : "Conectar");
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      state.openProvider = state.openProvider === provider.id ? null : provider.id;
      renderProviders();
    });
    row.append(toggle);
    box.append(row);

    if (state.openProvider === provider.id) {
      const form = node("form", "provider-form");
      const input = node("input");
      input.type = "password";
      input.placeholder = `Clave de API de ${provider.name}`;
      input.setAttribute("aria-label", `Clave de API de ${provider.name}`);
      input.autocomplete = "off";
      const save = node("button", "button primary", "Guardar");
      save.type = "submit";
      form.append(input, save);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        save.disabled = true;
        try {
          await invoke("connect_integration", { integrationId: provider.id, key: input.value });
          state.openProvider = null;
          await loadIntegrations();
          await loadModels();
        } catch (error) {
          renderProviders({ id: provider.id, message: errorText(error) });
        }
      });
      box.append(form);
      if (failure?.id === provider.id) box.append(node("div", "provider-error", failure.message));
      setTimeout(() => input.focus(), 0);
    }
    el.providerList.append(box);
  }
}

/* ---------- arranque ---------- */

function setStatus(kind, text) {
  el.status.className = `status ${kind}`;
  el.statusText.textContent = text;
  el.statusText.title = text;
}

async function boot() {
  setStatus("", "Iniciando el motor de OpenCode…");
  try {
    const info = await invoke("init");
    state.ready = true;
    setStatus("ok", `Motor OpenCode ${info.version}${info.tested ? "" : " · versión no probada"}`);
    await Promise.all([loadModels(), loadSessions()]);
    if (!info.tested) {
      showNotice(`OpenChat se probó con OpenCode ${info.testedSeries}.x y tienes la ${info.version}. Si algo falla, puede deberse a la diferencia de versión.`);
    }
  } catch (error) {
    setStatus("error", "Motor no disponible");
    showNotice(`No se pudo iniciar el motor de OpenCode: ${errorText(error)}`);
  }
  updateSendState();
  el.input.focus();
}

el.composer.addEventListener("submit", (event) => { event.preventDefault(); send(); });
el.input.addEventListener("input", () => { autoGrow(); updateSendState(); });
el.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
});
el.stop.addEventListener("click", stop);
$("new-chat").addEventListener("click", newChat);
$("toggle-sidebar").addEventListener("click", () => el.app.classList.toggle("sidebar-hidden"));
$("providers-btn").addEventListener("click", openProviders);
el.providerSearch.addEventListener("input", () => renderProviders());
el.modelBtn.addEventListener("click", () => toggleModelMenu(el.modelMenu.hidden));
el.modelSearch.addEventListener("input", renderModelList);

document.addEventListener("click", (event) => {
  if (!el.modelMenu.hidden && !event.target.closest(".model-picker")) toggleModelMenu(false);
  const link = event.target.closest("a[href]");
  if (link) {
    event.preventDefault(); // los enlaces se abren en el navegador, no dentro de la app
    invoke("open_external", { url: link.href }).catch(() => {});
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !el.modelMenu.hidden) toggleModelMenu(false);
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
    event.preventDefault();
    newChat();
  }
});

listen("oc-event", (event) => handleEvent(event.payload));
listen("oc-status", (event) => {
  if (!state.ready) return;
  if (event.payload === "stopped") setStatus("error", "El motor se detuvo");
  else if (event.payload === "reconnecting") setStatus("", "Reconectando…");
  else if (event.payload === "connected" && el.status.classList.contains("ok") === false) {
    setStatus("ok", "Motor OpenCode conectado");
    // El flujo de eventos no repite lo perdido: se vuelve a leer el estado.
    loadSessions().catch(() => {});
    if (state.sessionId) reloadMessages();
  }
});

boot();
