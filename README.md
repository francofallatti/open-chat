# OpenChat

Panel de chat de escritorio para modelos abiertos (DeepSeek, Kimi/Moonshot, Qwen, etc.), hecho en Rust con Tauri 2.

Funciona igual que OpenCode Desktop: arranca el CLI de OpenCode como servidor local privado y le habla por su API HTTP. Por eso usa los mismos proveedores, modelos y credenciales que ya tengas en OpenCode.

Hacia dónde va el proyecto: [ROADMAP.md](ROADMAP.md). Por qué está hecho así: [DECISIONS.md](DECISIONS.md).

## Requisitos

- Rust estable (MSVC en Windows) y WebView2 (incluido en Windows 11).
- OpenCode **v2**. Se busca en este orden:
  1. la ruta de la variable `OPENCHAT_OPENCODE_CLI`;
  2. el CLI incluido en OpenCode Desktop (`%LOCALAPPDATA%\Programs\ai.opencode.desktop\resources\opencode-cli.exe`);
  3. `opencode` en el `PATH`.

## Uso

```powershell
cargo run                                          # desarrollo
cargo build --release --features custom-protocol   # ejecutable: target\release\openchat.exe
cargo test                                         # pruebas
```

## Cómo funciona

| Pieza | Archivo | Qué hace |
| --- | --- | --- |
| Motor | `src/engine.rs` | Lanza `opencode-cli serve` en un puerto libre de `127.0.0.1`, con una contraseña aleatoria que solo vive en memoria. Lee el flujo SSE `/api/event` y lo reenvía a la vista. Detiene el servidor al cerrar. |
| Comandos | `src/main.rs` | Comandos Tauri acotados: modelos, chats, mensajes, enviar, detener, proveedores. Solo llaman al motor; no conocen la API de OpenCode. La vista no tiene acceso libre a la API. |
| Markdown | `src/markdown.rs` | Convierte la respuesta del modelo a HTML y la sanea (sin scripts ni imágenes remotas). |
| Vista | `ui/` | HTML, CSS y JavaScript sin dependencias ni paso de compilación. |

Decisiones a tener en cuenta:

- **Solo conversación.** Cada chat se crea con todos los permisos denegados, salvo leer dentro de su carpeta de trabajo, que está vacía: el modelo no puede escribir archivos, ejecutar comandos ni leer el resto del disco. El motivo de esa excepción está en [DECISIONS.md](DECISIONS.md).
- **Chats separados.** Las sesiones viven en `%APPDATA%\dev.openchat.desktop\workspace`; no se mezclan con tus proyectos de OpenCode, aunque comparten su base de datos.
- **Claves.** "Proveedores y claves" guarda la clave en el almacén de credenciales de OpenCode. OpenChat no la conserva.
- **Registro del motor:** `%APPDATA%\dev.openchat.desktop\server.log`.
