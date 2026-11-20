# Decisiones

Registro de las decisiones grandes del proyecto y su motivo. Se agrega una entrada nueva al final; una decisión que cambia no se borra, se marca como reemplazada.

## 1. OpenCode como motor

**Fecha:** 2026-11-18 · **Estado:** vigente

**Decisión.** OpenChat no habla con los proveedores de modelos. Arranca el CLI de OpenCode v2 como servidor local privado y usa su API HTTP.

**Motivo.** El motor ya resuelve lo más caro de construir y mantener: cientos de proveedores, almacén de credenciales, catálogo de modelos con costo y capacidades, variantes de esfuerzo, sesiones, MCP, skills y herramientas de archivos.

**Costo.**

- La API v2 es reciente y puede cambiar entre versiones.
- OpenCode es un agente de programación: por defecto envía instrucciones y herramientas pensadas para código.
- Quien instala OpenChat necesita además el motor.
- Las sesiones comparten la base de datos de OpenCode.

**Cuándo revisarla.** Si la API cambia seguido, si la distribución del motor se vuelve un obstáculo para quien instala, o si el comportamiento de agente de código no se puede apagar lo suficiente.

## 2. El motor queda detrás de una frontera

**Fecha:** 2026-11-19 · **Estado:** vigente, implementada

**Decisión.** La interfaz y los comandos usan tipos y errores propios (`src/chat.rs`). Todo lo que conoce el formato de OpenCode vive en un único módulo (`src/engine.rs`).

**Motivo.** Permite reemplazar el motor, o sumar uno que hable directo con los proveedores, sin reescribir la interfaz. También limita a un solo lugar el arreglo cuando OpenCode cambia su API.

## 3. Permisos: todo denegado salvo leer la carpeta de trabajo

**Fecha:** 2026-11-19 · **Estado:** vigente

**Decisión.** Cada chat se crea con todos los permisos denegados, excepto `read` dentro de la carpeta de trabajo de OpenChat, que está vacía.

**Motivo.** Con todo denegado, la petición sale sin herramientas, y el servicio de modelos gratuitos de OpenCode (proveedor `opencode`) la rechaza con un error 429 "Free usage limit reached", aunque no se haya consumido cupo. Se probó contra OpenCode 2.3.2:

| Permisos de la sesión | Modelo gratuito |
| --- | --- |
| Todo denegado | Rechazado |
| Todo denegado + `question` | Rechazado |
| Todo denegado + `read` | Responde |
| Todo denegado + `read` solo en la carpeta de trabajo | Responde |

Leer fuera de la carpeta de trabajo sigue denegado. Los modelos usados con clave propia no pasan por ese filtro.

**Riesgo.** El filtro lo decide el servicio de OpenCode y puede cambiar sin aviso. Si los modelos gratuitos vuelven a dar error de límite en chats nuevos, esta regla es lo primero a revisar.

## 4. Proyecto público, pensado para que lo instale cualquiera

**Fecha:** 2026-11-19 · **Estado:** vigente

**Decisión.** El repositorio es público y de código abierto. Las decisiones se toman pensando en alguien que instala la aplicación sin conocer OpenCode.

**Consecuencias.**

- Tiene que poder usarse sin pagar: niveles gratuitos de los proveedores y claves propias.
- La instalación del motor es parte del producto, no un requisito previo (fase 5).
- Las claves nunca se guardan en OpenChat ni salen de la máquina.
- Licencia MIT.

## 5. `main` es producción; todo cambio entra por una rama y pasa por la suite

**Fecha:** 2026-11-20 · **Estado:** vigente

**Decisión.** Nadie escribe directo en `main`. Cada cambio vive en una rama (`feat/...`, `fix/...`), abre un pull request y se une solo cuando la suite de punta a punta pasa completa sobre esa rama. Las versiones son etiquetas sobre `main`. No hay rama `development`.

Las pruebas de punta a punta manejan el ejecutable real en un entorno aislado (ver [TESTING.md](TESTING.md)).

**Motivo.** El proyecto lo trabajan una persona y sesiones de Claude Code en paralelo: una desarrolla y otra hace de QA. Lo que protege a `main` es la puerta de pruebas, no la cantidad de ramas. Una rama intermedia agregaría un paso de unión que no comprueba nada nuevo.

**Costo.**

- La suite solo corre en Windows, porque se conecta al WebView2.
- Los casos que llaman a un modelo dependen de la red y del cupo de un proveedor gratuito. Un fallo del proveedor deja el cambio sin verificar, no aprobado.

**Cuándo revisarla.** Si hace falta juntar varios cambios antes de publicar, se agrega una rama `release`. Si los fallos del proveedor frenan seguido la puerta, se suma un proveedor simulado para los casos `@modelo`.
