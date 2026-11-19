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

const USER: &str = "opencode";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const STARTUP_ATTEMPTS: u32 = 80;
const STARTUP_INTERVAL: Duration = Duration::from_millis(500);
/// Serie de OpenCode (mayor, menor) contra la que se probó OpenChat. La API v2
/// todavía cambia entre versiones menores, así que otra serie solo se avisa.
pub const TESTED_SERIES: (u64, u64) = (2, 3);

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
    pub async fn start(data_dir: &Path) -> Result<Self, String> {
        // Carpeta vacía y propia: las sesiones de OpenChat viven aquí, separadas de
        // los proyectos que el usuario abre en OpenCode.
        let workspace = data_dir.join("workspace");
        fs::create_dir_all(&workspace)
            .map_err(|e| format!("No se pudo crear {}: {e}", workspace.display()))?;

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
                let _ = app.emit("oc-status", "stopped");
                return;
            }
            let _ = app.emit("oc-status", "reconnecting");
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
        let _ = app.emit("oc-status", "connected");

        let mut stream = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        while let Some(chunk) = stream.next().await {
            buffer.extend_from_slice(&chunk.map_err(|e| e.to_string())?);
            for event in drain_events(&mut buffer) {
                if is_relevant(&event) {
                    let _ = app.emit("oc-event", event);
                }
            }
        }
        Ok(())
    }
}

/// Operaciones de chat. Es la única parte del programa que conoce las rutas y
/// los cuerpos de la API de OpenCode: el resto llama a estos métodos.
impl Engine {
    /// Modelos de chat disponibles, con el nombre de su proveedor, y el modelo por defecto.
    pub async fn models(&self) -> Result<Value, String> {
        let models = data(self.request(Method::GET, "/api/model", &[], None).await?);
        let providers = data(self.request(Method::GET, "/api/provider", &[], None).await?);
        let default = self
            .request(Method::GET, "/api/model/default", &[], None)
            .await
            .map(data)
            .unwrap_or(Value::Null);

        let provider_name = |id: &str| -> String {
            providers
                .as_array()
                .into_iter()
                .flatten()
                .find(|p| p.get("id").and_then(Value::as_str) == Some(id))
                .and_then(|p| p.get("name").and_then(Value::as_str))
                .unwrap_or(id)
                .to_owned()
        };

        let models: Vec<Value> = models
            .as_array()
            .into_iter()
            .flatten()
            .filter(|m| m.get("enabled").and_then(Value::as_bool) != Some(false))
            .filter_map(|m| {
                let id = m.get("id")?.as_str()?;
                let provider = m.get("providerID")?.as_str()?;
                Some(json!({
                    "id": id,
                    "providerID": provider,
                    "providerName": provider_name(provider),
                    "name": m.get("name").and_then(Value::as_str).unwrap_or(id),
                }))
            })
            .collect();

        let default = model_ref(&default).unwrap_or(Value::Null);
        Ok(json!({ "models": models, "default": default }))
    }

    /// Chats de OpenChat: solo las sesiones de su carpeta de trabajo.
    pub async fn sessions(&self) -> Result<Value, String> {
        let directory = self.workspace.display().to_string();
        let query = [("directory", directory.as_str()), ("limit", "200"), ("order", "desc")];
        Ok(data(self.request(Method::GET, "/api/session", &query, None).await?))
    }

    pub async fn create_session(&self, title: &str, model: &Value) -> Result<Value, String> {
        let body = json!({
            "title": title,
            "model": model_ref(model)?,
            "location": { "directory": self.workspace.display().to_string() },
            // OpenChat es solo conversación: el agente no puede escribir archivos,
            // ejecutar comandos ni usar otras herramientas. Solo conserva la lectura
            // dentro de su carpeta de trabajo (vacía): los modelos gratuitos de
            // OpenCode rechazan con "Free usage limit reached" las peticiones que
            // llegan sin la herramienta `read`.
            "permissions": [
                { "action": "*", "resource": "*", "effect": "deny" },
                {
                    "action": "read",
                    "resource": self.workspace.join("*").display().to_string(),
                    "effect": "allow",
                },
            ],
        });
        Ok(data(self.request(Method::POST, "/api/session", &[], Some(body)).await?))
    }

    pub async fn send_prompt(&self, session_id: &str, text: &str) -> Result<Value, String> {
        let path = format!("/api/session/{}/prompt", checked_id(session_id, "ses_")?);
        Ok(data(self.request(Method::POST, &path, &[], Some(json!({ "text": text }))).await?))
    }

    /// Todos los mensajes de una sesión, del más antiguo al más nuevo.
    pub async fn messages(&self, session_id: &str) -> Result<Value, String> {
        const PAGE_SIZE: usize = 100;
        const MAX_PAGES: usize = 50;

        let path = format!("/api/session/{}/message", checked_id(session_id, "ses_")?);
        let page_size = PAGE_SIZE.to_string();

        let mut messages: Vec<Value> = Vec::new();
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
            messages.extend(items.into_iter().map(with_own_error));

            cursor = page
                .pointer("/cursor/next")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if received < PAGE_SIZE || cursor.is_none() {
                break;
            }
        }
        Ok(Value::Array(messages))
    }

    pub async fn interrupt(&self, session_id: &str) -> Result<Value, String> {
        let path = format!("/api/session/{}/interrupt", checked_id(session_id, "ses_")?);
        self.request(Method::POST, &path, &[], None).await
    }

    pub async fn delete_session(&self, session_id: &str) -> Result<(), String> {
        let path = format!("/api/session/{}", checked_id(session_id, "ses_")?);
        self.request(Method::DELETE, &path, &[], None).await.map(|_| ())
    }

    pub async fn rename_session(&self, session_id: &str, title: &str) -> Result<(), String> {
        let path = format!("/api/session/{}", checked_id(session_id, "ses_")?);
        self.request(Method::PATCH, &path, &[], Some(json!({ "title": title })))
            .await
            .map(|_| ())
    }

    pub async fn set_session_model(&self, session_id: &str, model: &Value) -> Result<(), String> {
        let path = format!("/api/session/{}/model", checked_id(session_id, "ses_")?);
        self.request(Method::POST, &path, &[], Some(json!({ "model": model_ref(model)? })))
            .await
            .map(|_| ())
    }

    /// Proveedores que se conectan con una clave de API, y si ya están conectados.
    pub async fn integrations(&self) -> Result<Value, String> {
        let all = data(self.request(Method::GET, "/api/integration", &[], None).await?);
        let integrations: Vec<Value> = all
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|integration| {
                let id = integration.get("id")?.as_str()?;
                let accepts_key = integration
                    .get("methods")?
                    .as_array()?
                    .iter()
                    .any(|m| m.get("type").and_then(Value::as_str) == Some("key"));
                let connected = integration
                    .get("connections")
                    .and_then(Value::as_array)
                    .is_some_and(|c| !c.is_empty());
                accepts_key.then(|| {
                    json!({
                        "id": id,
                        "name": integration.get("name").and_then(Value::as_str).unwrap_or(id),
                        "connected": connected,
                    })
                })
            })
            .collect();
        Ok(Value::Array(integrations))
    }

    /// Guarda una clave de API en el almacén de credenciales de OpenCode.
    /// OpenChat no la conserva ni la escribe en disco por su cuenta.
    pub async fn connect_key(&self, integration_id: &str, key: &str) -> Result<(), String> {
        let key = key.trim();
        if key.is_empty() {
            return Err("La clave está vacía".into());
        }
        let path = format!("/api/integration/{}/connect/key", checked_id(integration_id, "")?);
        self.request(Method::POST, &path, &[], Some(json!({ "key": key })))
            .await
            .map(|_| ())
    }
}

/// Categorías de error propias de OpenChat. La vista decide qué mostrar y qué
/// acción ofrecer a partir de estas, sin conocer los códigos de OpenCode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ErrorKind {
    /// Se agotó el cupo del modelo o del plan.
    Quota,
    /// Demasiadas peticiones en poco tiempo.
    RateLimit,
    /// Clave ausente, inválida o sin permiso.
    Auth,
    /// El modelo o el proveedor no pueden atender la petición.
    Unavailable,
    /// No se pudo llegar al proveedor.
    Network,
    /// El proveedor bloqueó el contenido.
    Filtered,
    /// La persona detuvo la respuesta.
    Aborted,
    Unknown,
}

impl ErrorKind {
    /// Clasifica por el tipo que informa OpenCode y, si no lo reconoce, por el
    /// código HTTP del proveedor.
    fn classify(kind: &str, status: Option<u64>) -> Self {
        match kind {
            "aborted" => Self::Aborted,
            "provider.free-limit"
            | "provider.go-limit"
            | "provider.chatgpt-limit"
            | "provider.budget-limit"
            | "provider.model-budget-limit"
            | "provider.quota" => Self::Quota,
            "provider.rate-limit" => Self::RateLimit,
            "provider.auth" => Self::Auth,
            "provider.no-route" | "provider.unsupported-operation" | "provider.internal" => {
                Self::Unavailable
            }
            "provider.transport" | "provider.timeout" => Self::Network,
            "provider.content-filter" => Self::Filtered,
            _ => match status {
                Some(401 | 403) => Self::Auth,
                Some(429) => Self::RateLimit,
                Some(500..=599) => Self::Unavailable,
                _ => Self::Unknown,
            },
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Quota => "quota",
            Self::RateLimit => "rate_limit",
            Self::Auth => "auth",
            Self::Unavailable => "unavailable",
            Self::Network => "network",
            Self::Filtered => "filtered",
            Self::Aborted => "aborted",
            Self::Unknown => "unknown",
        }
    }

    /// Qué pasó y qué puede hacer la persona.
    fn message(self) -> &'static str {
        match self {
            Self::Quota => "Se agotó el cupo de este modelo. Cambia de modelo o conecta un proveedor con tu propia clave.",
            Self::RateLimit => "El proveedor está limitando las peticiones. Espera un momento y vuelve a intentar.",
            Self::Auth => "El proveedor rechazó la clave. Revísala en «Proveedores y claves».",
            Self::Unavailable => "El modelo no está disponible en este momento. Prueba con otro.",
            Self::Network => "No se pudo conectar con el proveedor. Revisa tu conexión y vuelve a intentar.",
            Self::Filtered => "El proveedor bloqueó la respuesta por su filtro de contenido.",
            Self::Aborted => "Respuesta detenida.",
            Self::Unknown => "El modelo devolvió un error.",
        }
    }
}

/// Convierte el error de OpenCode en el de OpenChat:
/// `{ kind, message, detail?, retryAfterMs? }`. `detail` conserva el texto
/// original del proveedor, para diagnóstico.
fn own_error(error: &Value) -> Value {
    let kind = ErrorKind::classify(
        error.get("type").and_then(Value::as_str).unwrap_or(""),
        error.get("status").and_then(Value::as_u64),
    );
    let mut own = json!({ "kind": kind.id(), "message": kind.message() });
    if let Some(detail) = error.get("message").and_then(Value::as_str).filter(|d| !d.is_empty()) {
        own["detail"] = json!(detail);
    }
    if let Some(wait) = error.get("retryAfterMs").and_then(Value::as_u64).filter(|w| *w > 0) {
        own["retryAfterMs"] = json!(wait);
    }
    own
}

/// Reemplaza el error de un mensaje, si lo tiene, por el de OpenChat.
fn with_own_error(mut message: Value) -> Value {
    if let Some(error) = message.get_mut("error").filter(|e| e.is_object()) {
        *error = own_error(error);
    }
    message
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

fn model_ref(model: &Value) -> Result<Value, String> {
    let id = model.get("id").and_then(Value::as_str);
    let provider = model.get("providerID").and_then(Value::as_str);
    match (id, provider) {
        (Some(id), Some(provider)) => Ok(json!({ "id": id, "providerID": provider })),
        _ => Err("Falta elegir un modelo".into()),
    }
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

fn is_relevant(event: &Value) -> bool {
    let Some(kind) = event.get("type").and_then(Value::as_str) else { return false };
    kind.starts_with("session.")
        || matches!(kind, "model.updated" | "provider.updated" | "integration.updated")
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
    use super::{
        checked_id, drain_events, is_relevant, own_error, series, with_own_error, ErrorKind,
    };
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
        assert_eq!(ErrorKind::classify("provider.free-limit", Some(429)), ErrorKind::Quota);
        assert_eq!(ErrorKind::classify("provider.rate-limit", Some(429)), ErrorKind::RateLimit);
        assert_eq!(ErrorKind::classify("provider.auth", Some(401)), ErrorKind::Auth);
        assert_eq!(ErrorKind::classify("provider.timeout", None), ErrorKind::Network);
        assert_eq!(ErrorKind::classify("provider.no-route", None), ErrorKind::Unavailable);
        assert_eq!(ErrorKind::classify("aborted", None), ErrorKind::Aborted);
        // Tipo desconocido: decide el código HTTP.
        assert_eq!(ErrorKind::classify("provider.unknown", Some(403)), ErrorKind::Auth);
        assert_eq!(ErrorKind::classify("provider.unknown", Some(503)), ErrorKind::Unavailable);
        assert_eq!(ErrorKind::classify("provider.unknown", None), ErrorKind::Unknown);
        assert_eq!(ErrorKind::classify("", None), ErrorKind::Unknown);
    }

    #[test]
    fn translates_a_real_free_limit_error() {
        // Forma capturada de OpenCode 2.3.2.
        let own = own_error(&json!({
            "type": "provider.free-limit",
            "message": "Free usage limit reached.",
            "status": 429,
            "response": { "body": "{}" },
            "retryAfterMs": 13259000,
        }));
        assert_eq!(own["kind"], "quota");
        assert_eq!(own["detail"], "Free usage limit reached.");
        assert_eq!(own["retryAfterMs"], 13259000);
        assert!(own.get("response").is_none());
        assert!(own["message"].as_str().unwrap().contains("cupo"));
    }

    #[test]
    fn leaves_messages_without_error_untouched() {
        let message = json!({ "type": "assistant", "content": [], "error": null });
        assert_eq!(with_own_error(message.clone()), message);
        let failed = with_own_error(json!({ "type": "assistant", "error": { "type": "aborted" } }));
        assert_eq!(failed["error"]["kind"], "aborted");
        assert!(failed["error"].get("detail").is_none());
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

    #[test]
    fn filters_events_the_view_does_not_use() {
        assert!(is_relevant(&json!({"type": "session.text.delta"})));
        assert!(is_relevant(&json!({"type": "model.updated"})));
        assert!(!is_relevant(&json!({"type": "pty.created"})));
        assert!(!is_relevant(&json!({"data": {}})));
    }
}
