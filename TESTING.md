# Pruebas

OpenChat tiene dos juegos de pruebas:

| Juego | Dónde | Qué cubre | Cómo se corre |
| --- | --- | --- | --- |
| Unitarias | `src/*.rs` | Traducción del formato del motor, saneado de markdown, validación de ids | `cargo test` |
| De punta a punta | `e2e/tests/` | La app real: ventana, motor y modelo | `npm test` dentro de `e2e/` |

Este documento trata sobre las segundas.

## Cómo funcionan

Cada caso abre el ejecutable real (`target\release\openchat.exe`), lo maneja como lo haría una persona y lo cierra. No hay simuladores: la ventana es la de verdad y el motor es OpenCode.

La ventana de Tauri en Windows es un WebView2. La suite le pide un puerto de depuración con `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` y [Playwright](https://playwright.dev/docs/webview2) se conecta a él. Por eso **solo corre en Windows**.

### Entorno aislado

Las pruebas nunca tocan los chats ni las claves de quien las corre. Cada caso crea una carpeta temporal y arranca la app con:

| Variable | Qué aísla |
| --- | --- |
| `OPENCHAT_DATA_DIR` | Los datos de OpenChat y, dentro de `engine/`, la base de datos, las credenciales y la configuración de OpenCode |
| `WEBVIEW2_USER_DATA_FOLDER` | El perfil del WebView2, donde se guarda el modelo elegido |

Al terminar se cierran la app y el motor, y se borra la carpeta. Un caso no ve nada de lo que dejó el anterior.

`OPENCHAT_DATA_DIR` también sirve a mano, para abrir OpenChat con un perfil vacío:

```powershell
$env:OPENCHAT_DATA_DIR = "$env:TEMP\openchat-limpio"; .\target\release\openchat.exe
```

## Correr la suite

```powershell
cargo build --release --features custom-protocol   # la suite prueba este ejecutable
cd e2e
npm install          # solo la primera vez
npm test             # todos los casos
npm run test:rapido  # sin los casos que llaman a un modelo
npm run casos        # lista los casos sin correrlos
```

Un caso o un área:

```powershell
npx playwright test -g "CHAT-002"
npx playwright test tests/sesiones.spec.js
```

Si un caso falla, el informe queda en `e2e\playwright-report\` con la captura de la ventana y el `server.log` del motor: `npx playwright show-report`.

| Variable | Para qué |
| --- | --- |
| `OPENCHAT_EXE` | Probar otro ejecutable en lugar de `target\release\openchat.exe` |
| `OPENCHAT_TEST_MODEL` | Texto que identifica en el selector al modelo de los casos `@modelo`. Sin ella se usa el que la app sugiere |

## Los casos

El catálogo es la suite misma: `npm run casos` lo imprime. No hay una lista aparte que mantener.

Cada caso tiene un identificador y un título que dice qué comprueba:

```js
test("SES-003 eliminar un chat pide confirmación y lo quita de la lista", async ({ page }) => {
```

| Prefijo | Archivo | Área |
| --- | --- | --- |
| `ARR` | `arranque.spec.js` | Arranque de la app y del motor, entorno limpio |
| `MOD` | `modelos.spec.js` | Selector y búsqueda de modelos |
| `CHAT` | `chat.spec.js` | Escribir, enviar y recibir |
| `SES` | `sesiones.spec.js` | Lista de chats: abrir, crear, eliminar |
| `PROV` | `proveedores.spec.js` | Diálogo de proveedores y claves |
| `ACC` | `accesibilidad.spec.js` | Contraste, teclado, foco y avisos |

### Casos que llaman a un modelo

Llevan la etiqueta `@modelo`. Usan un modelo gratuito real, así que dependen de la red y del cupo del proveedor. Comprueban la forma de la respuesta (llegó texto, no hubo error), nunca su contenido, porque el modelo no responde igual dos veces.

Cuando uno falla, el mensaje dice el tipo de error (`quota`, `rate_limit`, `network`…). Eso separa un problema del proveedor de un defecto de OpenChat.

### Casos con el modelo de prueba

Para comprobar qué le llega al modelo, o para tener una respuesta fija sin red ni cupo, un caso puede pedir un modelo local:

```js
test.describe("con el modelo de prueba", () => {
  test.use({ useFakeModel: true });

  test("CHAT-004 …", async ({ page, fakeModel }) => {
```

El motor arranca con un proveedor que apunta a un servidor de la propia suite. Aparece en el selector como `fakeModel.name`, contesta siempre `fakeModel.answer` y deja en `fakeModel.requests` cada petición que recibió. Para que conteste otro texto, por ejemplo markdown con un bloque de código, se agrega `fakeAnswer: "…"` al `test.use`. Para que rechace cada petición con un error en vez de contestar, se agrega `fakeFailure: "mensaje del error"`. Estos casos no llevan `@modelo`: corren también en `npm run test:rapido`.

## Escribir un caso

1. Elegir el archivo del área. Si es un área nueva, crear el archivo y agregar su prefijo a la tabla de arriba.
2. Tomar el siguiente número libre del prefijo. Un identificador no se reutiliza aunque el caso se borre.
3. Escribir el título como una afirmación que se pueda leer sola: qué hace la persona y qué ve.
4. Importar `test` y `expect` desde `../support/app.js`. El `page` que recibe el caso ya es la ventana de OpenChat con el motor conectado.
5. Buscar los elementos por `id` o por su nombre accesible, no por posición.
6. Después de un `page.reload()`, llamar a `appReady(page)` antes de seguir: espera a que carguen el motor, los modelos y los chats.
7. Si el caso necesita chats previos, usar `seedChat(page, "título")`: los crea sin llamar al modelo.
8. Etiquetar con `{ tag: "@modelo" }` solo si de verdad hace falta la respuesta de un modelo real. Si alcanza con una respuesta fija, usar el modelo de prueba.

## Regla para los cambios

- Una función nueva llega con su caso.
- Un defecto arreglado llega con el caso que lo reproduce.
- Un cambio pasa a `main` solo con la suite completa en verde sobre su rama.

## Con Claude Code

El repo trae dos skills en `.claude/skills/`:

| Comando | Qué hace | Cuándo |
| --- | --- | --- |
| `/qa [rama]` | Compila, corre las pruebas unitarias y toda la suite, y da un veredicto | Antes de unir una rama a `main` |
| `/qa rapido` | Lo mismo, sin los casos que llaman a un modelo. No da veredicto | Mientras se desarrolla |
| `/qa CHAT-002` o `/qa SES` | Corre solo ese caso o esa área. No da veredicto | Para revisar algo puntual |
| `/qa-cases [rama]` | Compara los cambios de la rama con la suite, escribe los casos que faltan y corre solo esos | Al terminar una función o un arreglo |

La sesión que escribe el código no corre `/qa` ni la suite completa: corre solo los casos que escribió o cambió y abre el pull request. La puerta la corre otra sesión, sobre ese pull request.

`/qa` informa y no toca el código. `/qa-cases` escribe casos. Están separadas para que quien aprueba no sea quien acomoda las pruebas.

## Pendientes de automatizar

Casos que hoy se comprueban a mano:

- Detener una respuesta en curso con el botón «Detener».
- Conectar un proveedor con una clave válida y con una inválida.
- Mensaje de error del modelo por cupo agotado, con el tiempo de espera.
- Aviso de versión del motor fuera de la serie probada.
- Bloques de código en la respuesta y su botón «Copiar».
- Los enlaces de una respuesta se abren en el navegador y no dentro de la app.
