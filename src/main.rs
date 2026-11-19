#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
mod markdown;

use std::sync::Arc;

use reqwest::Method;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, RunEvent, State};
use tokio::sync::OnceCell;

use backend::Backend;

#[derive(Default)]
struct AppState {
    backend: OnceCell<Arc<Backend>>,
}

/// Devuelve el motor, arrancándolo en el primer uso. Si el arranque falla, el
/// siguiente intento vuelve a probar.
async fn engine(app: &AppHandle, state: &State<'_, AppState>) -> Result<Arc<Backend>, String> {
    state
        .backend
        .get_or_try_init(|| async {
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let backend = Arc::new(Backend::start(&data_dir).await?);
            tauri::async_runtime::spawn(backend.clone().pump_events(app.clone()));
            Ok::<_, String>(backend)
        })
        .await
        .cloned()
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

#[tauri::command]
async fn init(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let backend = engine(&app, &state).await?;
    Ok(json!({
        "version": backend.version,
        "cli": backend.cli.display().to_string(),
        "workspace": backend.workspace.display().to_string(),
    }))
}

/// Modelos de chat disponibles, con el nombre de su proveedor, y el modelo por defecto.
#[tauri::command]
async fn list_models(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let backend = engine(&app, &state).await?;
    let models = data(backend.request(Method::GET, "/api/model", &[], None).await?);
    let providers = data(backend.request(Method::GET, "/api/provider", &[], None).await?);
    let default = backend
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
#[tauri::command]
async fn list_sessions(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let backend = engine(&app, &state).await?;
    let directory = backend.workspace.display().to_string();
    let query = [("directory", directory.as_str()), ("limit", "200"), ("order", "desc")];
    Ok(data(backend.request(Method::GET, "/api/session", &query, None).await?))
}

#[tauri::command]
async fn create_session(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    model: Value,
) -> Result<Value, String> {
    let backend = engine(&app, &state).await?;
    let body = json!({
        "title": title,
        "model": model_ref(&model)?,
        "location": { "directory": backend.workspace.display().to_string() },
        // OpenChat es solo conversación: el agente no puede escribir archivos,
        // ejecutar comandos ni usar otras herramientas. Solo conserva la lectura
        // dentro de su carpeta de trabajo (vacía): los modelos gratuitos de
        // OpenCode rechazan con "Free usage limit reached" las peticiones que
        // llegan sin la herramienta `read`.
        "permissions": [
            { "action": "*", "resource": "*", "effect": "deny" },
            {
                "action": "read",
                "resource": backend.workspace.join("*").display().to_string(),
                "effect": "allow",
            },
        ],
    });
    Ok(data(backend.request(Method::POST, "/api/session", &[], Some(body)).await?))
}

#[tauri::command]
async fn send_prompt(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    text: String,
) -> Result<Value, String> {
    let backend = engine(&app, &state).await?;
    let path = format!("/api/session/{}/prompt", checked_id(&session_id, "ses_")?);
    Ok(data(backend.request(Method::POST, &path, &[], Some(json!({ "text": text }))).await?))
}

/// Todos los mensajes de una sesión, del más antiguo al más nuevo.
#[tauri::command]
async fn list_messages(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, String> {
    const PAGE_SIZE: usize = 100;
    const MAX_PAGES: usize = 50;

    let backend = engine(&app, &state).await?;
    let path = format!("/api/session/{}/message", checked_id(&session_id, "ses_")?);
    let page_size = PAGE_SIZE.to_string();

    let mut messages: Vec<Value> = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let mut query = vec![("order", "asc"), ("limit", page_size.as_str())];
        if let Some(cursor) = cursor.as_deref() {
            query.push(("cursor", cursor));
        }
        let mut page = backend.request(Method::GET, &path, &query, None).await?;
        let items = match page.get_mut("data").map(Value::take) {
            Some(Value::Array(items)) => items,
            _ => break,
        };
        let received = items.len();
        messages.extend(items);

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

#[tauri::command]
async fn interrupt_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, String> {
    let backend = engine(&app, &state).await?;
    let path = format!("/api/session/{}/interrupt", checked_id(&session_id, "ses_")?);
    backend.request(Method::POST, &path, &[], None).await
}

#[tauri::command]
async fn delete_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let backend = engine(&app, &state).await?;
    let path = format!("/api/session/{}", checked_id(&session_id, "ses_")?);
    backend.request(Method::DELETE, &path, &[], None).await.map(|_| ())
}

#[tauri::command]
async fn rename_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let backend = engine(&app, &state).await?;
    let path = format!("/api/session/{}", checked_id(&session_id, "ses_")?);
    backend
        .request(Method::PATCH, &path, &[], Some(json!({ "title": title })))
        .await
        .map(|_| ())
}

#[tauri::command]
async fn set_session_model(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    model: Value,
) -> Result<(), String> {
    let backend = engine(&app, &state).await?;
    let path = format!("/api/session/{}/model", checked_id(&session_id, "ses_")?);
    backend
        .request(Method::POST, &path, &[], Some(json!({ "model": model_ref(&model)? })))
        .await
        .map(|_| ())
}

/// Proveedores que se conectan con una clave de API, y si ya están conectados.
#[tauri::command]
async fn list_integrations(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let backend = engine(&app, &state).await?;
    let all = data(backend.request(Method::GET, "/api/integration", &[], None).await?);
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
#[tauri::command]
async fn connect_integration(
    app: AppHandle,
    state: State<'_, AppState>,
    integration_id: String,
    key: String,
) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("La clave está vacía".into());
    }
    let backend = engine(&app, &state).await?;
    let path = format!("/api/integration/{}/connect/key", checked_id(&integration_id, "")?);
    backend
        .request(Method::POST, &path, &[], Some(json!({ "key": key })))
        .await
        .map(|_| ())
}

#[tauri::command]
fn render_markdown(text: String) -> String {
    markdown::render(&text)
}

/// Abre un enlace en el navegador del sistema, nunca dentro de la ventana de la app.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Solo se abren enlaces http(s)".into());
    }
    open::that_detached(&url).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            init,
            list_models,
            list_sessions,
            create_session,
            send_prompt,
            list_messages,
            interrupt_session,
            delete_session,
            rename_session,
            set_session_model,
            list_integrations,
            connect_integration,
            render_markdown,
            open_external,
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar OpenChat")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(backend) = app.state::<AppState>().backend.get() {
                    backend.shutdown();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::checked_id;

    #[test]
    fn rejects_ids_that_could_change_the_route() {
        assert!(checked_id("ses_e10169a17ffeSiEZtQed4ssjyc", "ses_").is_ok());
        assert!(checked_id("moonshotai-cn", "").is_ok());
        assert!(checked_id("ses_1/../../shell", "ses_").is_err());
        assert!(checked_id("ses_1?x=1", "ses_").is_err());
        assert!(checked_id("msg_123", "ses_").is_err());
    }
}
