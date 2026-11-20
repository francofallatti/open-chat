#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod chat;
mod engine;
mod markdown;

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, RunEvent, State};
use tokio::sync::OnceCell;

use chat::{Chat, Message, ModelCatalog, ModelRef, Provider};
use engine::Engine;

#[derive(Default)]
struct AppState {
    engine: OnceCell<Arc<Engine>>,
}

/// Devuelve el motor, arrancándolo en el primer uso. Si el arranque falla, el
/// siguiente intento vuelve a probar.
async fn engine(app: &AppHandle, state: &State<'_, AppState>) -> Result<Arc<Engine>, String> {
    state
        .engine
        .get_or_try_init(|| async {
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let engine = Arc::new(Engine::start(&data_dir).await?);
            tauri::async_runtime::spawn(engine.clone().pump_events(app.clone()));
            Ok::<_, String>(engine)
        })
        .await
        .cloned()
}

#[tauri::command]
async fn init(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let engine = engine(&app, &state).await?;
    Ok(json!({
        "version": engine.version,
        "tested": engine.version_tested(),
        "testedSeries": format!("{}.{}", engine::TESTED_SERIES.0, engine::TESTED_SERIES.1),
        "cli": engine.cli.display().to_string(),
        "workspace": engine.workspace.display().to_string(),
    }))
}

#[tauri::command]
async fn list_models(app: AppHandle, state: State<'_, AppState>) -> Result<ModelCatalog, String> {
    engine(&app, &state).await?.models().await
}

#[tauri::command]
async fn list_chats(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<Chat>, String> {
    engine(&app, &state).await?.chats().await
}

#[tauri::command]
async fn create_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    model: ModelRef,
) -> Result<Chat, String> {
    engine(&app, &state).await?.create_chat(&title, &model).await
}

#[tauri::command]
async fn send_prompt(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
    text: String,
) -> Result<(), String> {
    engine(&app, &state).await?.send_prompt(&chat_id, &text).await
}

#[tauri::command]
async fn list_messages(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<Vec<Message>, String> {
    engine(&app, &state).await?.messages(&chat_id).await
}

#[tauri::command]
async fn interrupt_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<(), String> {
    engine(&app, &state).await?.interrupt(&chat_id).await
}

#[tauri::command]
async fn delete_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<(), String> {
    engine(&app, &state).await?.delete_chat(&chat_id).await
}

#[tauri::command]
async fn rename_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
    title: String,
) -> Result<(), String> {
    engine(&app, &state).await?.rename_chat(&chat_id, &title).await
}

#[tauri::command]
async fn set_chat_model(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
    model: ModelRef,
) -> Result<(), String> {
    engine(&app, &state).await?.set_chat_model(&chat_id, &model).await
}

#[tauri::command]
async fn list_providers(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<Provider>, String> {
    engine(&app, &state).await?.providers().await
}

#[tauri::command]
async fn connect_provider(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
    key: String,
) -> Result<(), String> {
    engine(&app, &state).await?.connect_key(&provider_id, &key).await
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
            list_chats,
            create_chat,
            send_prompt,
            list_messages,
            interrupt_chat,
            delete_chat,
            rename_chat,
            set_chat_model,
            list_providers,
            connect_provider,
            render_markdown,
            open_external,
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar OpenChat")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(engine) = app.state::<AppState>().engine.get() {
                    engine.shutdown();
                }
            }
        });
}
