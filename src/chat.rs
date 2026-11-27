//! Tipos propios de OpenChat: lo que la vista recibe y envía.
//!
//! No dependen de ningún motor. El módulo `engine` traduce el formato de
//! OpenCode a estos tipos, y es el único que conoce ese formato.

use serde::{Deserialize, Serialize};

/// Identifica un modelo dentro de un proveedor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelRef {
    pub id: String,
    pub provider: String,
    /// Esfuerzo de razonamiento elegido, uno de los `efforts` del modelo.
    /// Sin valor, el modelo usa el suyo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub provider: String,
    pub provider_name: String,
    pub name: String,
    /// Esfuerzos de razonamiento que se pueden elegir, en el orden en que el
    /// modelo los publica. Vacío si no admite elegir.
    pub efforts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ModelCatalog {
    pub models: Vec<Model>,
    /// Modelo sugerido cuando la persona todavía no eligió uno.
    pub default: Option<ModelRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub id: String,
    pub title: String,
    /// Última actividad, en milisegundos desde 1970.
    pub updated_at: u64,
    pub model: Option<ModelRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "role", rename_all = "camelCase")]
pub enum Message {
    User {
        id: String,
        text: String,
    },
    Assistant {
        id: String,
        parts: Vec<Part>,
        model: Option<ModelRef>,
        error: Option<ChatError>,
    },
}

/// Fragmento de una respuesta del modelo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Part {
    Text { text: String },
    Reasoning { text: String },
    /// El modelo intentó usar una herramienta. `failed` indica que no se ejecutó.
    Tool { name: String, failed: bool },
}

/// Tipo de fragmento que llega en vivo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamKind {
    Text,
    Reasoning,
}

/// Por qué falló una respuesta. La vista decide qué ofrecer según la categoría.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
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
    /// Qué pasó y qué puede hacer la persona.
    pub fn message(self) -> &'static str {
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatError {
    pub kind: ErrorKind,
    pub message: String,
    /// Texto original del proveedor, para diagnóstico.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

/// Proveedor que se conecta con una clave de API.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub connected: bool,
}

/// Lo que el motor le avisa a la vista mientras está en marcha.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Event {
    /// Cambiaron los modelos o proveedores disponibles.
    CatalogChanged,
    ChatRenamed { chat_id: String, title: String },
    ChatDeleted { chat_id: String },
    /// El modelo empezó a trabajar en un chat.
    ResponseStarted { chat_id: String },
    /// El modelo terminó, con éxito, con error o detenido. El resultado se lee
    /// de los mensajes del chat.
    ResponseEnded { chat_id: String },
    /// Llegó más texto de un fragmento en curso.
    PartDelta {
        chat_id: String,
        message_id: String,
        index: u64,
        kind: StreamKind,
        delta: String,
    },
    /// Un fragmento quedó completo; `text` reemplaza lo acumulado.
    PartDone {
        chat_id: String,
        message_id: String,
        index: u64,
        kind: StreamKind,
        text: String,
    },
}

/// Estado de la conexión con el motor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EngineStatus {
    Connected,
    Reconnecting,
    Stopped,
}
