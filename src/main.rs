#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod markdown;

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, RunEvent, State};
use tokio::sync::OnceCell;

use engine::Engine;

#[derive(Default)]
struct AppState {
    backend: OnceCell<Arc<Engine>>,
}

/// Devuelve el motor, arrancándolo en el primer uso. Si el arranque falla, el
/// siguiente intento vuelve a probar.
async fn engine(app: &AppHandle, state: &State<'_, AppState>) -> Result<Arc<Engine>, String> {
    state
        .backend
        .get_or_try_init(|| async {
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let backend = Arc::new(Engine::start(&data_dir).await?);
            tauri::async_runtime::spawn(backend.clone().pump_events(app.clone()));
            Ok::<_, String>(backend)
        })
        .await
        .cloned()
}

#[tauri::command]
async fn init(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let engine = engine(&app, &state).await?;
    Ok(json!({
        "version": engine.version,
        "cli": engine.cli.display().to_string(),
        "workspace": engine.workspace.display().to_string(),
    }))
}

#[tauri::command]
async fn list_models(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    engine(&app, &state).await?.models().await
}

#[tauri::command]
async fn list_sessions(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    engine(&app, &state).await?.sessions().await
}

#[tauri::command]
async fn create_session(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    model: Value,
) -> Result<Value, String> {
    engine(&app, &state).await?.create_session(&title, &model).await
}

#[tauri::command]
async fn send_prompt(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    text: String,
) -> Result<Value, String> {
    engine(&app, &state).await?.send_prompt(&session_id, &text).await
}

#[tauri::command]
async fn list_messages(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, String> {
    engine(&app, &state).await?.messages(&session_id).await
}

#[tauri::command]
async fn interrupt_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, String> {
    engine(&app, &state).await?.interrupt(&session_id).await
}

#[tauri::command]
async fn delete_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    engine(&app, &state).await?.delete_session(&session_id).await
}

#[tauri::command]
async fn rename_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    engine(&app, &state).await?.rename_session(&session_id, &title).await
}

#[tauri::command]
async fn set_session_model(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    model: Value,
) -> Result<(), String> {
    engine(&app, &state).await?.set_session_model(&session_id, &model).await
}

#[tauri::command]
async fn list_integrations(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    engine(&app, &state).await?.integrations().await
}

#[tauri::command]
async fn connect_integration(
    app: AppHandle,
    state: State<'_, AppState>,
    integration_id: String,
    key: String,
) -> Result<(), String> {
    engine(&app, &state).await?.connect_key(&integration_id, &key).await
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
