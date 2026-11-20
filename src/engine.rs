//! Motor de chat. Todo lo que conoce OpenCode vive en este módulo: un servidor `opencode serve` privado, igual que hace OpenCode Desktop.
//!
//! OpenChat arranca el CLI de OpenCode en un puerto local libre, protegido con una
//! contraseña aleatoria que solo vive en memoria, y le habla por su API HTTP v2
//! (`/api/...`) más un flujo SSE de eventos (`/api/event`).

use std::fs::{self, File};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Method;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::chat::{
    Chat, ChatError, EngineStatus, ErrorKind, Event, Message, Model, ModelCatalog, ModelRef, Part,
    Provider, StreamKind,
};

const USER: &str = "opencode";
/// Canales por los que la vista recibe los eventos y el estado del motor.
const EVENT_CHANNEL: &str = "engine-event";
const STATUS_CHANNEL: &str = "engine-status";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const STARTUP_ATTEMPTS: u32 = 80;
const STARTUP_INTERVAL: Duration = Duration::from_millis(500);
/// Serie de OpenCode (mayor, menor) contra la que se probó OpenChat. La API v2
/// todavía cambia entre versiones menores, así que otra serie solo se avisa.
pub const TESTED_SERIES: (u64, u64) = (2, 3);

/// Agente con el que conversan los chats de OpenChat. Su `system` reemplaza las
/// instrucciones de programación del agente por defecto de OpenCode (`build`).
const AGENT_ID: &str = "openchat";
const AGENT_SYSTEM: &str = "You are the assistant in OpenChat, a desktop chat app. You are having a conversation with a person: answer what they ask, clearly and directly.

- Reply in the language the person writes in.
- Responses are rendered as GitHub-flavored Markdown. Use it when it helps, and put code in fenced blocks with the language name.
- Be concise by default and go deeper when the question needs it or the person asks.
- If you are not sure about something, say so instead of guessing.
- You cannot browse the web, run commands or see the person's files. If a request needs any of that, say so and help with what you can from the conversation.
- The working directory described below is an internal, empty folder of the app. It is not the person's project: do not mention it or look for files in it.
";

pub struct Engine {
    client: reqwest::Client,
    base: String,
    password: String,
    child: Mutex<Option<Child>>,
    pub workspace: PathBuf,
    pub cli: PathBuf,
    pub version: String,
}

impl Engine {
    /// Arranca el servidor y espera a que responda.
    ///
    /// Con `engine_home`, OpenCode guarda ahí su base de datos, credenciales y
    /// configuración en lugar de usar el almacén compartido del usuario.
    pub async fn start(data_dir: &Path, engine_home: Option<&Path>) -> Result<Self, String> {
        // Carpeta propia, sin archivos del usuario: las sesiones de OpenChat viven
        // aquí, separadas de los proyectos que el usuario abre en OpenCode.
        let workspace = data_dir.join("workspace");
        fs::create_dir_all(&workspace)
            .map_err(|e| format!("No se pudo crear {}: {e}", workspace.display()))?;

        write_agent_config(&workspace)?;

        let cli = locate_cli()?;
        let port = free_port()?;
        let password = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );

        let log_path = data_dir.join("server.log");
        let log = File::create(&log_path)
            .map_err(|e| format!("No se pudo crear {}: {e}", log_path.display()))?;
        let log_err = log.try_clone().map_err(|e| e.to_string())?;

        let mut command = Command::new(&cli);
        command
            .args(["serve", "--hostname", "127.0.0.1", "--port", &port.to_string()])
            .current_dir(&workspace)
            .env("OPENCODE_SERVER_PASSWORD", &password)
            .stdin(Stdio::null())
            .stdout(log)
            .stderr(log_err);
        if let Some(home) = engine_home {
            for (var, folder) in [
                ("XDG_DATA_HOME", "data"),
                ("XDG_CONFIG_HOME", "config"),
                ("XDG_STATE_HOME", "state"),
                ("XDG_CACHE_HOME", "cache"),
            ] {
                command.env(var, home.join(folder));
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let child = command
            .spawn()
            .map_err(|e| format!("No se pudo ejecutar {}: {e}", cli.display()))?;

        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .build()
            .map_err(|e| e.to_string())?;

        let mut backend = Engine {
            client,
            base: format!("http://127.0.0.1:{port}"),
            password,
            child: Mutex::new(Some(child)),
            workspace,
            cli,
            version: String::new(),
        };

        match backend.wait_until_ready().await {
            Ok(version) => {
                backend.version = version;
                Ok(backend)
            }
            Err(reason) => {
                backend.shutdown();
                Err(format!("{reason} (registro: {})", log_path.display()))
            }
        }
    }

    async fn wait_until_ready(&self) -> Result<String, String> {
        for _ in 0..STARTUP_ATTEMPTS {
            if let Some(status) = self.exit_status() {
                return Err(format!("El servidor de OpenCode terminó al arrancar ({status})"));
            }
            if let Ok(info) = self.request(Method::GET, "/api/info", &[], None).await {
                return match info.get("version").and_then(Value::as_str) {
                    Some(version) => Ok(version.to_owned()),
                    None => Err("El servidor respondió sin versión; se requiere OpenCode v2".into()),
                };
            }
            tokio::time::sleep(STARTUP_INTERVAL).await;
        }
        Err("El servidor de OpenCode no respondió a tiempo; se requiere OpenCode v2".into())
    }

    /// Indica si el motor en uso es de la serie probada.
    pub fn version_tested(&self) -> bool {
        series(&self.version) == Some(TESTED_SERIES)
    }

    fn exit_status(&self) -> Option<String> {
        let mut guard = self.child.lock().ok()?;
        let child = guard.as_mut()?;
        child.try_wait().ok().flatten().map(|s| s.to_string())
    }

    /// Detiene el servidor y sus procesos hijos.
    pub fn shutdown(&self) {
        let Ok(mut guard) = self.child.lock() else { return };
        let Some(mut child) = guard.take() else { return };
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            // /T termina también los procesos que el servidor haya lanzado.
            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    /// Petición JSON a la API. Devuelve `Null` cuando la respuesta no trae cuerpo.
    async fn request(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, &str)],
        body: Option<Value>,
    ) -> Result<Value, String> {
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.base))
            .basic_auth(USER, Some(&self.password))
            .timeout(REQUEST_TIMEOUT)
            .query(query);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|e| e.to_string())?;
        let status = response.status();
        let text = response.text().await.map_err(|e| e.to_string())?;
        let parsed: Option<Value> = serde_json::from_str(&text).ok();

        if !status.is_success() {
            let message = parsed
                .as_ref()
                .and_then(|v| v.get("message"))
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| text.chars().take(300).collect());
            return Err(format!("{message} (HTTP {})", status.as_u16()));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        parsed.ok_or_else(|| "El servidor devolvió una respuesta que no es JSON".to_owned())
    }

    /// Reenvía a la vista los eventos del servidor mientras este siga vivo.
    /// El flujo es volátil por contrato: tras una reconexión la vista recarga su estado.
    pub async fn pump_events(self: Arc<Self>, app: AppHandle) {
        loop {
            let outcome = self.stream_events(&app).await;
            if self.exit_status().is_some() || self.child.lock().map(|c| c.is_none()).unwrap_or(true) {
                let _ = app.emit(STATUS_CHANNEL, EngineStatus::Stopped);
                return;
            }
            let _ = app.emit(STATUS_CHANNEL, EngineStatus::Reconnecting);
            if let Err(reason) = outcome {
                eprintln!("flujo de eventos interrumpido: {reason}");
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    async fn stream_events(&self, app: &AppHandle) -> Result<(), String> {
        let response = self
            .client
            .get(format!("{}/api/event", self.base))
            .basic_auth(USER, Some(&self.password))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status().as_u16()));
        }
        let _ = app.emit(STATUS_CHANNEL, EngineStatus::Connected);

        let mut stream = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        while let Some(chunk) = stream.next().await {
            buffer.extend_from_slice(&chunk.map_err(|e| e.to_string())?);
            for raw in drain_events(&mut buffer) {
                if let Some(event) = own_event(&raw) {
                    let _ = app.emit(EVENT_CHANNEL, event);
                }
            }
        }
        Ok(())
    }
}

/// Operaciones de chat. Es la única parte del programa que conoce las rutas y
/// los cuerpos de la API de OpenCode: recibe y devuelve tipos de `chat`.
impl Engine {
    /// Modelos de chat disponibles, con el nombre de su proveedor, y el modelo por defecto.
    pub async fn models(&self) -> Result<ModelCatalog, String> {
        let models = data(self.request(Method::GET, "/api/model", &[], None).await?);
        let providers = data(self.request(Method::GET, "/api/provider", &[], None).await?);
        let default = self
            .request(Method::GET, "/api/model/default", &[], None)
            .await
            .map(data)
            .unwrap_or(Value::Null);

        let provider_name = |id: &str| -> String {
            list(&providers)
                .find(|p| text(p, "id") == Some(id))
                .and_then(|p| text(p, "name"))
                .unwrap_or(id)
                .to_owned()
        };

        let models = list(&models)
            .filter(|m| m.get("enabled").and_then(Value::as_bool) != Some(false))
            .filter_map(|m| {
                let id = text(m, "id")?;
                let provider = text(m, "providerID")?;
                Some(Model {
                    id: id.to_owned(),
                    provider: provider.to_owned(),
                    provider_name: provider_name(provider),
                    name: text(m, "name").unwrap_or(id).to_owned(),
                })
            })
            .collect();

        Ok(ModelCatalog { models, default: own_model_ref(&default) })
    }

    /// Chats de OpenChat: solo las sesiones de su carpeta de trabajo.
    pub async fn chats(&self) -> Result<Vec<Chat>, String> {
        let directory = self.workspace.display().to_string();
        let query = [("directory", directory.as_str()), ("limit", "200"), ("order", "desc")];
        let sessions = data(self.request(Method::GET, "/api/session", &query, None).await?);
        Ok(list(&sessions).filter_map(own_chat).collect())
    }

    pub async fn create_chat(&self, title: &str, model: &ModelRef) -> Result<Chat, String> {
        let body = json!({
            "title": title,
            "model": engine_model_ref(model),
            "agent": AGENT_ID,
            "location": { "directory": self.workspace.display().to_string() },
            // OpenChat es solo conversación: el agente no puede escribir archivos,
            // ejecutar comandos ni usar otras herramientas. Solo conserva la lectura
            // dentro de su carpeta de trabajo, que no tiene archivos del usuario: los
            // modelos gratuitos de OpenCode rechazan con "Free usage limit reached"
            // las peticiones que llegan sin la herramienta `read`.
            "permissions": [
                { "action": "*", "resource": "*", "effect": "deny" },
                {
                    "action": "read",
                    "resource": self.workspace.join("*").display().to_string(),
                    "effect": "allow",
                },
            ],
        });
        let session = data(self.request(Method::POST, "/api/session", &[], Some(body)).await?);
        own_chat(&session).ok_or_else(|| "El motor creó el chat pero no devolvió su identificador".to_owned())
    }

    pub async fn send_prompt(&self, chat_id: &str, prompt: &str) -> Result<(), String> {
        let path = format!("/api/session/{}/prompt", checked_id(chat_id, "ses_")?);
        self.request(Method::POST, &path, &[], Some(json!({ "text": prompt })))
            .await
            .map(|_| ())
    }

    /// Todos los mensajes de un chat, del más antiguo al más nuevo.
    pub async fn messages(&self, chat_id: &str) -> Result<Vec<Message>, String> {
        const PAGE_SIZE: usize = 100;
        const MAX_PAGES: usize = 50;

        let path = format!("/api/session/{}/message", checked_id(chat_id, "ses_")?);
        let page_size = PAGE_SIZE.to_string();

        let mut raw: Vec<Value> = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let mut query = vec![("order", "asc"), ("limit", page_size.as_str())];
            if let Some(cursor) = cursor.as_deref() {
                query.push(("cursor", cursor));
            }
            let mut page = self.request(Method::GET, &path, &query, None).await?;
            let items = match page.get_mut("data").map(Value::take) {
                Some(Value::Array(items)) => items,
                _ => break,
            };
            let received = items.len();
            raw.extend(items);

            cursor = page
                .pointer("/cursor/next")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if received < PAGE_SIZE || cursor.is_none() {
                break;
            }
        }
        Ok(own_messages(&raw))
    }

    pub async fn interrupt(&self, chat_id: &str) -> Result<(), String> {
        let path = format!("/api/session/{}/interrupt", checked_id(chat_id, "ses_")?);
        self.request(Method::POST, &path, &[], None).await.map(|_| ())
    }

    pub async fn delete_chat(&self, chat_id: &str) -> Result<(), String> {
        let path = format!("/api/session/{}", checked_id(chat_id, "ses_")?);
        self.request(Method::DELETE, &path, &[], None).await.map(|_| ())
    }

    pub async fn rename_chat(&self, chat_id: &str, title: &str) -> Result<(), String> {
        let path = format!("/api/session/{}", checked_id(chat_id, "ses_")?);
        self.request(Method::PATCH, &path, &[], Some(json!({ "title": title })))
            .await
            .map(|_| ())
    }

    pub async fn set_chat_model(&self, chat_id: &str, model: &ModelRef) -> Result<(), String> {
        let path = format!("/api/session/{}/model", checked_id(chat_id, "ses_")?);
        self.request(Method::POST, &path, &[], Some(json!({ "model": engine_model_ref(model) })))
            .await
            .map(|_| ())
    }

    /// Proveedores que se conectan con una clave de API, y si ya están conectados.
    pub async fn providers(&self) -> Result<Vec<Provider>, String> {
        let all = data(self.request(Method::GET, "/api/integration", &[], None).await?);
        let providers = list(&all)
            .filter_map(|integration| {
                let id = text(integration, "id")?;
                let accepts_key = list(integration.get("methods")?)
                    .any(|m| text(m, "type") == Some("key"));
                let connected = integration
                    .get("connections")
                    .and_then(Value::as_array)
                    .is_some_and(|c| !c.is_empty());
                accepts_key.then(|| Provider {
                    id: id.to_owned(),
                    name: text(integration, "name").unwrap_or(id).to_owned(),
                    connected,
                })
            })
            .collect();
        Ok(providers)
    }

    /// Guarda una clave de API en el almacén de credenciales de OpenCode.
    /// OpenChat no la conserva ni la escribe en disco por su cuenta.
    pub async fn connect_key(&self, provider_id: &str, key: &str) -> Result<(), String> {
        let key = key.trim();
        if key.is_empty() {
            return Err("La clave está vacía".into());
        }
        let path = format!("/api/integration/{}/connect/key", checked_id(provider_id, "")?);
        self.request(Method::POST, &path, &[], Some(json!({ "key": key })))
            .await
            .map(|_| ())
    }
}

/* ---------- traducción de OpenCode a los tipos de OpenChat ---------- */

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn list(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn own_model_ref(model: &Value) -> Option<ModelRef> {
    Some(ModelRef {
        id: text(model, "id")?.to_owned(),
        provider: text(model, "providerID")?.to_owned(),
    })
}

fn engine_model_ref(model: &ModelRef) -> Value {
    json!({ "id": model.id, "providerID": model.provider })
}

fn own_chat(session: &Value) -> Option<Chat> {
    Some(Chat {
        id: text(session, "id")?.to_owned(),
        title: text(session, "title").unwrap_or("").to_owned(),
        updated_at: session.pointer("/time/updated").and_then(Value::as_u64).unwrap_or(0),
        model: session.get("model").and_then(own_model_ref),
    })
}

fn own_part(part: &Value) -> Option<Part> {
    match text(part, "type")? {
        "text" => Some(Part::Text { text: text(part, "text")?.to_owned() }),
        "reasoning" => Some(Part::Reasoning { text: text(part, "text")?.to_owned() }),
        "tool" => Some(Part::Tool {
            name: text(part, "name").unwrap_or("").to_owned(),
            failed: part.pointer("/state/status").and_then(Value::as_str) == Some("error"),
        }),
        _ => None,
    }
    .filter(|part| !matches!(part, Part::Text { text } | Part::Reasoning { text } if text.is_empty()))
}

/// Traduce el historial de una sesión. OpenCode intercala mensajes de control
/// (`idle`, entre otros) que no son parte de la conversación.
fn own_messages(raw: &[Value]) -> Vec<Message> {
    let mut messages: Vec<Message> = Vec::new();
    for message in raw {
        let id = text(message, "id").unwrap_or("").to_owned();
        let error = message.get("error").filter(|e| e.is_object()).map(own_error);
        match text(message, "type") {
            Some("user") => messages.push(Message::User {
                id,
                text: text(message, "text").unwrap_or("").to_owned(),
            }),
            Some("assistant") => messages.push(Message::Assistant {
                id,
                parts: list(message.get("content").unwrap_or(&Value::Null))
                    .filter_map(own_part)
                    .collect(),
                model: message.get("model").and_then(own_model_ref),
                error,
            }),
            // Cuando la respuesta falla antes de empezar (modelo inexistente,
            // por ejemplo), el error solo viene en el mensaje `idle`. Si la
            // respuesta ya lo trae, el `idle` lo repite y se descarta.
            Some("idle") => {
                let already_shown =
                    matches!(messages.last(), Some(Message::Assistant { error: Some(_), .. }));
                if let (Some(error), false) = (error, already_shown) {
                    messages.push(Message::Assistant { id, parts: Vec::new(), model: None, error: Some(error) });
                }
            }
            _ => {}
        }
    }
    messages
}

/// Clasifica por el tipo que informa OpenCode y, si no lo reconoce, por el
/// código HTTP del proveedor.
fn error_kind(kind: &str, status: Option<u64>) -> ErrorKind {
    match kind {
        "aborted" => ErrorKind::Aborted,
        "provider.free-limit"
        | "provider.go-limit"
        | "provider.chatgpt-limit"
        | "provider.budget-limit"
        | "provider.model-budget-limit"
        | "provider.quota" => ErrorKind::Quota,
        "provider.rate-limit" => ErrorKind::RateLimit,
        "provider.auth" => ErrorKind::Auth,
        "provider.no-route" | "provider.unsupported-operation" | "provider.internal" => {
            ErrorKind::Unavailable
        }
        "provider.transport" | "provider.timeout" => ErrorKind::Network,
        "provider.content-filter" => ErrorKind::Filtered,
        _ => match status {
            Some(401 | 403) => ErrorKind::Auth,
            Some(429) => ErrorKind::RateLimit,
            Some(500..=599) => ErrorKind::Unavailable,
            _ => ErrorKind::Unknown,
        },
    }
}

fn own_error(error: &Value) -> ChatError {
    let kind = error_kind(
        text(error, "type").unwrap_or(""),
        error.get("status").and_then(Value::as_u64),
    );
    ChatError {
        kind,
        message: kind.message().to_owned(),
        detail: text(error, "message").filter(|d| !d.is_empty()).map(str::to_owned),
        retry_after_ms: error.get("retryAfterMs").and_then(Value::as_u64).filter(|w| *w > 0),
    }
}

/// Traduce un evento del flujo de OpenCode. Devuelve `None` para los que la
/// vista no usa.
fn own_event(raw: &Value) -> Option<Event> {
    let kind = text(raw, "type")?;
    if matches!(kind, "model.updated" | "provider.updated" | "integration.updated") {
        return Some(Event::CatalogChanged);
    }
    let data = raw.get("data")?;
    let chat_id = text(data, "sessionID")?.to_owned();

    let stream = |kind: StreamKind| -> Option<(String, u64, StreamKind)> {
        Some((
            text(data, "assistantMessageID")?.to_owned(),
            data.get("ordinal").and_then(Value::as_u64).unwrap_or(0),
            kind,
        ))
    };
    let delta = |kind: StreamKind| -> Option<Event> {
        let (message_id, index, kind) = stream(kind)?;
        Some(Event::PartDelta { chat_id: chat_id.clone(), message_id, index, kind, delta: text(data, "delta")?.to_owned() })
    };
    let done = |kind: StreamKind| -> Option<Event> {
        let (message_id, index, kind) = stream(kind)?;
        Some(Event::PartDone { chat_id: chat_id.clone(), message_id, index, kind, text: text(data, "text")?.to_owned() })
    };

    match kind {
        "session.renamed" => Some(Event::ChatRenamed {
            title: text(data, "title").unwrap_or("").to_owned(),
            chat_id,
        }),
        "session.deleted" => Some(Event::ChatDeleted { chat_id }),
        "session.execution.started" => Some(Event::ResponseStarted { chat_id }),
        "session.execution.succeeded" | "session.execution.failed" | "session.execution.interrupted" => {
            Some(Event::ResponseEnded { chat_id })
        }
        "session.text.delta" => delta(StreamKind::Text),
        "session.reasoning.delta" => delta(StreamKind::Reasoning),
        "session.text.ended" => done(StreamKind::Text),
        "session.reasoning.ended" => done(StreamKind::Reasoning),
        _ => None,
    }
}

/// Los identificadores llegan de la vista y se insertan en rutas: se validan
/// para que no puedan cambiar de endpoint.
fn checked_id<'a>(value: &'a str, prefix: &str) -> Result<&'a str, String> {
    let valid = value.starts_with(prefix)
        && value.len() <= 128
        && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    if valid {
        Ok(value)
    } else {
        Err(format!("Identificador no válido: {value}"))
    }
}

fn data(mut response: Value) -> Value {
    response.get_mut("data").map(Value::take).unwrap_or(Value::Null)
}

/// Extrae del búfer los eventos SSE completos y deja el resto para la próxima lectura.
fn drain_events(buffer: &mut Vec<u8>) -> Vec<Value> {
    // Un retorno de carro nunca aparece dentro de una línea `data:` JSON, así que
    // quitarlo solo normaliza los fines de línea.
    buffer.retain(|byte| *byte != b'\r');

    let mut events = Vec::new();
    while let Some(end) = buffer.windows(2).position(|pair| pair == b"\n\n") {
        let block: Vec<u8> = buffer.drain(..end + 2).collect();
        let Ok(block) = std::str::from_utf8(&block) else { continue };
        let data: Vec<&str> = block
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(|line| line.strip_prefix(' ').unwrap_or(line))
            .collect();
        if data.is_empty() {
            continue; // comentario o latido
        }
        if let Ok(event) = serde_json::from_str::<Value>(&data.join("\n")) {
            events.push(event);
        }
    }
    events
}

/// Define el agente de conversación en la configuración de la carpeta de trabajo.
/// OpenCode la lee como configuración de proyecto, así que vale solo para los
/// chats de OpenChat y no toca la configuración global del usuario.
fn write_agent_config(workspace: &Path) -> Result<(), String> {
    let config = json!({
        "agents": {
            AGENT_ID: {
                "description": "Conversación de OpenChat",
                "mode": "primary",
                "system": AGENT_SYSTEM,
            },
        },
    });
    let path = workspace.join("opencode.json");
    fs::write(&path, format!("{config:#}"))
        .map_err(|e| format!("No se pudo escribir {}: {e}", path.display()))
}

/// CLI a usar, por prioridad: `OPENCHAT_OPENCODE_CLI`, el incluido en OpenCode
/// Desktop, y por último `opencode` en el PATH.
///
/// El de Desktop va primero porque su versión es la que migra la base de datos
/// compartida de OpenCode; un CLI más viejo falla contra ese esquema.
fn locate_cli() -> Result<PathBuf, String> {
    if let Some(custom) = std::env::var_os("OPENCHAT_OPENCODE_CLI") {
        let path = PathBuf::from(custom);
        return if path.is_file() {
            Ok(path)
        } else {
            Err(format!("OPENCHAT_OPENCODE_CLI apunta a un archivo que no existe: {}", path.display()))
        };
    }
    #[cfg(windows)]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let bundled = PathBuf::from(local)
            .join("Programs")
            .join("ai.opencode.desktop")
            .join("resources")
            .join("opencode-cli.exe");
        if bundled.is_file() {
            return Ok(bundled);
        }
    }
    Ok(PathBuf::from("opencode"))
}

/// Mayor y menor de una versión como `2.3.2` o `v2.3.2-beta.1`.
fn series(version: &str) -> Option<(u64, u64)> {
    let mut parts = version.trim().trim_start_matches('v').split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    Some((major, minor))
}

fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_ids_that_could_change_the_route() {
        assert!(checked_id("ses_e10169a17ffeSiEZtQed4ssjyc", "ses_").is_ok());
        assert!(checked_id("moonshotai-cn", "").is_ok());
        assert!(checked_id("ses_1/../../shell", "ses_").is_err());
        assert!(checked_id("ses_1?x=1", "ses_").is_err());
        assert!(checked_id("msg_123", "ses_").is_err());
    }

    #[test]
    fn reads_the_series_of_a_version() {
        assert_eq!(series("2.3.2"), Some((2, 3)));
        assert_eq!(series("v2.10.0-beta.1"), Some((2, 10)));
        assert_eq!(series("2"), None);
        assert_eq!(series(""), None);
        assert_eq!(series("dev"), None);
    }

    #[test]
    fn classifies_engine_errors() {
        assert_eq!(error_kind("provider.free-limit", Some(429)), ErrorKind::Quota);
        assert_eq!(error_kind("provider.rate-limit", Some(429)), ErrorKind::RateLimit);
        assert_eq!(error_kind("provider.auth", Some(401)), ErrorKind::Auth);
        assert_eq!(error_kind("provider.timeout", None), ErrorKind::Network);
        assert_eq!(error_kind("provider.no-route", None), ErrorKind::Unavailable);
        assert_eq!(error_kind("aborted", None), ErrorKind::Aborted);
        // Tipo desconocido: decide el código HTTP.
        assert_eq!(error_kind("provider.unknown", Some(403)), ErrorKind::Auth);
        assert_eq!(error_kind("provider.unknown", Some(503)), ErrorKind::Unavailable);
        assert_eq!(error_kind("provider.unknown", None), ErrorKind::Unknown);
        assert_eq!(error_kind("", None), ErrorKind::Unknown);
    }

    // Las formas de estas pruebas se capturaron de OpenCode 2.3.2.

    #[test]
    fn translates_a_free_limit_error() {
        let own = own_error(&json!({
            "type": "provider.free-limit",
            "message": "Free usage limit reached.",
            "status": 429,
            "response": { "body": "{}" },
            "retryAfterMs": 13259000,
        }));
        assert_eq!(own.kind, ErrorKind::Quota);
        assert_eq!(own.detail.as_deref(), Some("Free usage limit reached."));
        assert_eq!(own.retry_after_ms, Some(13259000));
        assert_eq!(
            serde_json::to_value(&own).unwrap(),
            json!({
                "kind": "quota",
                "message": ErrorKind::Quota.message(),
                "detail": "Free usage limit reached.",
                "retryAfterMs": 13259000,
            })
        );
    }

    #[test]
    fn translates_a_chat() {
        let chat = own_chat(&json!({
            "id": "ses_e09cc0decffeGpOhFIyzSkhxRe",
            "projectID": "97d60a5b",
            "model": { "id": "deepseek-v4.1-flash-free", "providerID": "opencode", "variant": "default" },
            "time": { "created": 1795131961887u64, "updated": 1795131994964u64 },
            "title": "captura",
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(&chat).unwrap(),
            json!({
                "id": "ses_e09cc0decffeGpOhFIyzSkhxRe",
                "title": "captura",
                "updatedAt": 1795131994964u64,
                "model": { "id": "deepseek-v4.1-flash-free", "provider": "opencode" },
            })
        );
        assert!(own_chat(&json!({ "title": "sin id" })).is_none());
    }

    #[test]
    fn translates_a_conversation_and_drops_control_messages() {
        let messages = own_messages(&[
            json!({ "id": "msg_1", "type": "user", "text": "hola" }),
            json!({
                "id": "msg_2", "type": "assistant", "agent": "build",
                "model": { "id": "m", "providerID": "p", "variant": "default" },
                "content": [
                    { "type": "reasoning", "text": "pienso" },
                    { "type": "tool", "id": "call_1", "name": "read", "executed": false,
                      "state": { "status": "error", "error": { "type": "permission.rejected" } } },
                    { "type": "text", "text": "" },
                    { "type": "text", "text": "Hola." },
                ],
            }),
            json!({ "id": "msg_3", "type": "idle", "outcome": "succeeded" }),
        ]);
        assert_eq!(
            serde_json::to_value(&messages).unwrap(),
            json!([
                { "role": "user", "id": "msg_1", "text": "hola" },
                {
                    "role": "assistant", "id": "msg_2",
                    "parts": [
                        { "type": "reasoning", "text": "pienso" },
                        { "type": "tool", "name": "read", "failed": true },
                        { "type": "text", "text": "Hola." },
                    ],
                    "model": { "id": "m", "provider": "p" },
                    "error": null,
                },
            ])
        );
    }

    #[test]
    fn shows_an_error_that_only_comes_in_the_idle_message() {
        // El modelo no existe: no llega a haber mensaje del asistente.
        let messages = own_messages(&[
            json!({ "id": "msg_1", "type": "user", "text": "hola" }),
            json!({ "id": "msg_2", "type": "idle", "outcome": "failed",
                    "error": { "type": "provider.no-route", "message": "Model unavailable: google/x" } }),
        ]);
        assert_eq!(messages.len(), 2);
        let Message::Assistant { parts, error: Some(error), .. } = &messages[1] else {
            panic!("se esperaba una respuesta con error");
        };
        assert!(parts.is_empty());
        assert_eq!(error.kind, ErrorKind::Unavailable);
    }

    #[test]
    fn does_not_repeat_an_error_already_on_the_response() {
        let error = json!({ "type": "provider.free-limit", "message": "x", "status": 429 });
        let messages = own_messages(&[
            json!({ "id": "msg_1", "type": "assistant", "content": [], "error": error }),
            json!({ "id": "msg_2", "type": "idle", "outcome": "failed", "error": error }),
        ]);
        assert_eq!(messages.len(), 1);
    }

    #[test]
    fn translates_stream_events() {
        let delta = own_event(&json!({
            "type": "session.text.delta",
            "data": { "sessionID": "ses_1", "assistantMessageID": "msg_9", "ordinal": 2, "delta": "ho" },
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(&delta).unwrap(),
            json!({ "type": "partDelta", "chatId": "ses_1", "messageId": "msg_9", "index": 2, "kind": "text", "delta": "ho" })
        );

        let done = own_event(&json!({
            "type": "session.reasoning.ended",
            "data": { "sessionID": "ses_1", "assistantMessageID": "msg_9", "ordinal": 0, "text": "listo" },
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(&done).unwrap(),
            json!({ "type": "partDone", "chatId": "ses_1", "messageId": "msg_9", "index": 0, "kind": "reasoning", "text": "listo" })
        );
    }

    #[test]
    fn translates_chat_lifecycle_events() {
        let event = |kind: &str, data: Value| own_event(&json!({ "type": kind, "data": data }));
        let session = json!({ "sessionID": "ses_1" });

        assert_eq!(event("model.updated", json!({})), Some(Event::CatalogChanged));
        assert_eq!(
            event("session.renamed", json!({ "sessionID": "ses_1", "title": "nuevo" })),
            Some(Event::ChatRenamed { chat_id: "ses_1".into(), title: "nuevo".into() })
        );
        assert_eq!(event("session.deleted", session.clone()), Some(Event::ChatDeleted { chat_id: "ses_1".into() }));
        assert_eq!(
            event("session.execution.started", session.clone()),
            Some(Event::ResponseStarted { chat_id: "ses_1".into() })
        );
        for ended in ["succeeded", "failed", "interrupted"] {
            assert_eq!(
                event(&format!("session.execution.{ended}"), session.clone()),
                Some(Event::ResponseEnded { chat_id: "ses_1".into() })
            );
        }
        // Eventos que la vista no usa.
        assert_eq!(event("session.step.started", session.clone()), None);
        assert_eq!(event("pty.created", json!({})), None);
        assert_eq!(own_event(&json!({ "data": {} })), None);
    }

    /// Recorrido completo contra un OpenCode real: arranca el motor, crea un
    /// chat, espera la respuesta y lo borra. Necesita OpenCode instalado, red y
    /// un modelo que responda, así que no corre por defecto:
    ///
    /// ```text
    /// cargo test -- --ignored real_engine
    /// ```
    ///
    /// El modelo se elige con `OPENCHAT_TEST_MODEL=proveedor/modelo`.
    #[test]
    #[ignore = "necesita OpenCode instalado y acceso a un modelo"]
    fn real_engine_answers_a_prompt() {
        let wanted = std::env::var("OPENCHAT_TEST_MODEL")
            .unwrap_or_else(|_| "opencode/deepseek-v4.1-flash-free".to_owned());
        let (provider, id) = wanted.split_once('/').expect("formato proveedor/modelo");
        let model = ModelRef { id: id.to_owned(), provider: provider.to_owned() };

        let data_dir = std::env::temp_dir().join(format!("openchat-test-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&data_dir).unwrap();

        tauri::async_runtime::block_on(async {
            let engine = Engine::start(&data_dir, None).await.expect("el motor no arrancó");
            assert!(series(&engine.version).is_some(), "versión ilegible: {}", engine.version);

            let catalog = engine.models().await.unwrap();
            assert!(
                catalog.models.iter().any(|m| m.id == model.id && m.provider == model.provider),
                "el modelo {wanted} no está en el catálogo"
            );
            assert!(!engine.providers().await.unwrap().is_empty());

            let chat = engine.create_chat("prueba de OpenChat", &model).await.unwrap();
            assert_eq!(chat.model.as_ref(), Some(&model));
            assert!(engine.chats().await.unwrap().iter().any(|c| c.id == chat.id));

            engine.send_prompt(&chat.id, "Responde solo con la palabra: hola").await.unwrap();

            let mut answer = None;
            for _ in 0..60 {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let messages = engine.messages(&chat.id).await.unwrap();
                answer = messages.iter().rev().find_map(|message| match message {
                    Message::Assistant { error: Some(error), .. } => Some(Err(error.clone())),
                    Message::Assistant { parts, .. } => parts.iter().find_map(|part| match part {
                        Part::Text { text } => Some(Ok(text.clone())),
                        _ => None,
                    }),
                    Message::User { .. } => None,
                });
                if answer.is_some() {
                    break;
                }
            }

            engine.rename_chat(&chat.id, "prueba renombrada").await.unwrap();
            engine.delete_chat(&chat.id).await.unwrap();
            assert!(!engine.chats().await.unwrap().iter().any(|c| c.id == chat.id));
            engine.shutdown();

            match answer {
                Some(Ok(text)) => assert!(!text.trim().is_empty()),
                Some(Err(error)) => panic!("el modelo devolvió un error: {error:?}"),
                None => panic!("el modelo no respondió a tiempo"),
            }
        });
        let _ = fs::remove_dir_all(&data_dir);
    }

    #[test]
    fn drains_complete_events_and_keeps_the_partial_tail() {
        let mut buffer = b": heartbeat\r\n\r\ndata: {\"type\":\"session.text.delta\",\"data\":{\"delta\":\"ho\"}}\r\n\r\ndata: {\"type\":\"sess".to_vec();
        let events = drain_events(&mut buffer);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["data"]["delta"], "ho");
        assert_eq!(buffer, b"data: {\"type\":\"sess".to_vec());

        buffer.extend_from_slice(b"ion.idle\"}\n\n");
        let events = drain_events(&mut buffer);
        assert_eq!(events, vec![json!({"type": "session.idle"})]);
        assert!(buffer.is_empty());
    }

    #[test]
    fn keeps_multibyte_text_split_across_chunks() {
        let full = "data: {\"type\":\"session.text.delta\",\"data\":{\"delta\":\"ñandú\"}}\n\n".as_bytes();
        let (head, tail) = full.split_at(52); // corta dentro de un carácter UTF-8
        let mut buffer = head.to_vec();
        assert!(drain_events(&mut buffer).is_empty());
        buffer.extend_from_slice(tail);
        assert_eq!(drain_events(&mut buffer)[0]["data"]["delta"], "ñandú");
    }
}
