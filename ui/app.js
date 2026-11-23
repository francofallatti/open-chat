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
  model: null,            // { id, provider }
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
  return !!a && !!b && a.id === b.id && a.provider === b.provider;
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
  // Preferencia guardada por una versión anterior, con el nombre de campo viejo.
  if (saved?.providerID && !saved.provider) saved = { id: saved.id, provider: saved.providerID };
  const known = (m) => m && models.some((x) => sameModel(x, m));
  if (!known(state.model)) {
    state.model = known(saved) ? saved : known(fallback) ? fallback : models[0] ? { id: models[0].id, provider: models[0].provider } : null;
  }
  renderModelButton();
  if (!el.modelMenu.hidden) renderModelList(true);
}

function renderModelButton() {
  const current = state.models.find((m) => sameModel(m, state.model));
  el.modelLabel.textContent = current ? current.name : "Sin modelos disponibles";
  updateSendState();
}

// keepActive: la lista se vuelve a dibujar porque cambió el catálogo, no porque
// la persona buscó, así que la opción activa sigue siendo la que era.
function renderModelList(keepActive = false) {
  const previous = keepActive ? el.modelList.querySelector(".model-option.active")?.dataset.key : null;
  const term = el.modelSearch.value.trim().toLowerCase();
  const matches = state.models.filter((m) => !term || `${m.name} ${m.providerName} ${m.id}`.toLowerCase().includes(term));
  el.modelList.replaceChildren();
  if (!matches.length) {
    el.modelList.append(node("div", "model-empty", state.models.length ? "Ningún modelo coincide." : "No hay modelos. Conecta un proveedor."));
    setActiveOption(null);
    return;
  }
  const groups = new Map();
  for (const m of matches) {
    if (!groups.has(m.providerName)) groups.set(m.providerName, []);
    groups.get(m.providerName).push(m);
  }
  let count = 0;
  for (const [provider, items] of groups) {
    const label = node("div", "model-group", provider);
    label.id = `model-group-${count}`;
    const group = node("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-labelledby", label.id);
    group.append(label);
    for (const m of items) {
      // El foco se queda en el buscador: las opciones no son botones y la activa
      // se le indica al lector de pantalla con aria-activedescendant.
      const option = node("div", "model-option", m.name);
      option.id = `model-option-${count++}`;
      option.dataset.key = `${m.provider}/${m.id}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(sameModel(m, state.model)));
      option.addEventListener("click", () => chooseModel({ id: m.id, provider: m.provider }));
      option.addEventListener("pointermove", () => setActiveOption(option, false));
      group.append(option);
    }
    el.modelList.append(group);
  }
  const options = modelOptions();
  setActiveOption(
    (previous && options.find((o) => o.dataset.key === previous))
    || (term ? null : options.find((o) => o.getAttribute("aria-selected") === "true"))
    || options[0],
  );
}

function modelOptions() {
  return [...el.modelList.querySelectorAll(".model-option")];
}

function setActiveOption(option, scroll = true) {
  for (const other of modelOptions()) other.classList.toggle("active", other === option);
  if (option) {
    el.modelSearch.setAttribute("aria-activedescendant", option.id);
    // Se mueve solo la lista: scrollIntoView también desplazaría la ventana.
    if (scroll) {
      const list = el.modelList.getBoundingClientRect();
      const item = option.getBoundingClientRect();
      if (item.top < list.top) el.modelList.scrollTop -= list.top - item.top;
      else if (item.bottom > list.bottom) el.modelList.scrollTop += item.bottom - list.bottom;
    }
  } else {
    el.modelSearch.removeAttribute("aria-activedescendant");
  }
}

function modelSearchKey(event) {
  const options = modelOptions();
  const index = options.findIndex((o) => o.classList.contains("active"));
  const target = {
    ArrowDown: options[Math.min(index + 1, options.length - 1)],
    ArrowUp: options[Math.max(index - 1, 0)],
    Home: options[0],
    End: options[options.length - 1],
  }[event.key];
  if (target) {
    event.preventDefault();
    setActiveOption(target);
  } else if (event.key === "Enter") {
    event.preventDefault(); // Enter en el buscador nunca envía el mensaje a medio escribir
    options[index]?.click();
  } else if (event.key === "Tab") {
    toggleModelMenu(false); // el foco sigue su camino al control anterior o siguiente
  }
}

function toggleModelMenu(open) {
  el.modelMenu.hidden = !open;
  el.modelBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    el.modelSearch.value = "";
    // El menú no pasa del borde de la ventana: abre hacia abajo en la pantalla
    // inicial y hacia arriba cuando hay un chat.
    const button = el.modelBtn.getBoundingClientRect();
    const space = el.main.classList.contains("empty") ? window.innerHeight - button.bottom : button.top;
    el.modelMenu.style.maxHeight = `${Math.max(140, Math.min(420, space - 20))}px`;
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
      await invoke("set_chat_model", { chatId: state.sessionId, model });
      showNotice("");
    } catch (error) {
      showNotice(`No se pudo cambiar el modelo: ${errorText(error)}`);
    }
  }
}

/* ---------- lista de chats ---------- */

async function loadSessions() {
  state.sessions = (await invoke("list_chats")) || [];
  renderSessions();
}

function sessionTitle(session) {
  return session?.title?.trim() || "Nuevo chat";
}

function renderSessions() {
  const sorted = [...state.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
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
    await invoke("delete_chat", { chatId: session.id });
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
    state.model = { id: session.model.id, provider: session.model.provider };
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
    const messages = await invoke("list_messages", { chatId: id });
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
  for (const part of message.parts || []) {
    if (part.type === "text" && part.text) {
      texts.push(part.text);
      box.append(await proseBlock(part.text));
    } else if (part.type === "reasoning" && part.text) {
      box.append(reasoningBlock(part.text, false));
    } else if (part.type === "tool") {
      box.append(node("span", "tool-chip", `Herramienta ${part.name}${part.failed ? " · no permitida" : ""}`));
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
    if (message.role === "user") {
      nodes.push(node("div", "msg user", message.text));
    } else if (message.role === "assistant") {
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
  let part = live.parts.find((p) => p.type === type && p.index === ordinal);
  if (!part) {
    part = { type, index: ordinal, text: "", node: null };
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

// Los eventos llegan ya traducidos por el motor (ver `Event` en src/chat.rs).
function handleEvent(event) {
  if (event.type === "catalogChanged") {
    clearTimeout(handleEvent.modelsTimer);
    handleEvent.modelsTimer = setTimeout(() => loadModels().catch(() => {}), 400);
    return;
  }
  const sessionId = event.chatId;
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return; // chat ajeno a OpenChat

  switch (event.type) {
    case "chatRenamed":
      session.title = event.title;
      renderSessions();
      return;
    case "chatDeleted":
      state.sessions = state.sessions.filter((s) => s.id !== sessionId);
      if (state.sessionId === sessionId) newChat(); else renderSessions();
      return;
    case "responseStarted":
      state.busy.add(sessionId);
      session.updatedAt = Date.now();
      renderSessions();
      if (sessionId === state.sessionId) updateSendState();
      return;
    case "responseEnded":
      finishExecution(sessionId);
      return;
  }

  if (sessionId !== state.sessionId) return;
  if (event.type === "partDelta") {
    const live = liveResponse(event.messageId);
    livePart(live, event.kind, event.index).text += event.delta;
    scheduleLivePaint(live);
  } else if (event.type === "partDone") {
    const live = liveResponse(event.messageId);
    livePart(live, event.kind, event.index).text = event.text;
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
      const session = await invoke("create_chat", { title, model: state.model });
      state.sessions.unshift(session);
      state.sessionId = session.id;
    }
    const sessionId = state.sessionId;
    el.input.value = "";
    autoGrow();
    state.messages.push({ role: "user", text });
    state.busy.add(sessionId);
    renderSessions();
    updateSendState();
    await renderThread(true);
    await invoke("send_prompt", { chatId: sessionId, text });
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
    await invoke("interrupt_chat", { chatId: state.sessionId });
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
    state.integrations = await invoke("list_providers");
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
          await invoke("connect_provider", { providerId: provider.id, key: input.value });
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
el.modelSearch.addEventListener("input", () => renderModelList());
el.modelSearch.addEventListener("keydown", modelSearchKey);
// Un clic en la lista no le quita el foco al buscador.
el.modelList.addEventListener("mousedown", (event) => event.preventDefault());
// Si el foco sale del selector con Tab, el menú se cierra.
el.modelMenu.parentElement.addEventListener("focusout", (event) => {
  if (!el.modelMenu.hidden && event.relatedTarget && !event.relatedTarget.closest(".model-picker")) toggleModelMenu(false);
});

document.addEventListener("click", (event) => {
  if (!el.modelMenu.hidden && !event.target.closest(".model-picker")) toggleModelMenu(false);
  const link = event.target.closest("a[href]");
  if (link) {
    event.preventDefault(); // los enlaces se abren en el navegador, no dentro de la app
    invoke("open_external", { url: link.href }).catch(() => {});
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !el.modelMenu.hidden) {
    toggleModelMenu(false);
    el.modelBtn.focus(); // el foco vuelve al botón que abrió el menú
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
    event.preventDefault();
    newChat();
  }
});

listen("engine-event", (event) => handleEvent(event.payload));
listen("engine-status", (event) => {
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
