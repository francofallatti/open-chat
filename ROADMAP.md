# Hoja de ruta

OpenChat busca ser una interfaz de chat de escritorio completa para cualquier modelo: abiertos (DeepSeek, Kimi, Qwen…) y, si la persona tiene clave, también Claude, Gemini y demás. Debe poder usarse sin pagar, con los niveles gratuitos de los proveedores.

Las fases van en orden. Cada una deja la aplicación usable. El porqué de las decisiones grandes está en [DECISIONS.md](DECISIONS.md).

## Estado actual

- Chat con respuesta en vivo, varios chats, cambio de modelo, detener, renombrar, borrar.
- Conexión de proveedores con clave de API.
- Motor: el CLI de OpenCode v2 como servidor local privado.
- Solo Windows probado.

## Fase 1 — Frontera del motor

Objetivo: que la interfaz no sepa que detrás hay OpenCode.

- [x] Sacar de `src/main.rs` todas las rutas y cuerpos de la API de OpenCode y dejarlos en un módulo de motor (`src/engine.rs`).
- [ ] Definir tipos propios (modelo, chat, mensaje, evento, error) que la vista consume, independientes del formato de OpenCode.
- [ ] Traducir los errores del motor a categorías propias: cupo agotado, clave inválida, modelo no disponible, red.
- [ ] Comprobar la versión del motor al arrancar y avisar si no es una versión probada.

## Fase 2 — Chat sólido

- [ ] Agente propio de conversación, sin las instrucciones de programación que OpenCode envía por defecto.
- [ ] Selector de esfuerzo de razonamiento (las variantes `minimal` a `max` que ya publica cada modelo).
- [ ] Etiquetar en el selector: gratis, de pago, cupo diario, tamaño de contexto.
- [ ] Mostrar el razonamiento del modelo cuando lo emite.
- [ ] Mensajes de error claros, con la acción a tomar.
- [ ] Editar y reenviar un mensaje; regenerar una respuesta.
- [ ] Buscar entre chats.

## Fase 3 — Orquestador

- [ ] Lista ordenada de modelos de respaldo, elegida por la persona.
- [ ] Ante un error de cupo o límite, pasar al siguiente modelo y reenviar el mensaje, avisando del cambio.
- [ ] Recordar hasta cuándo está agotado cada modelo y saltarlo mientras tanto.
- [ ] Medidor de uso por modelo: tokens y costo de la sesión.
- [ ] Recomendación de modelo según la tarea (texto, código, archivos largos), a partir de los datos del catálogo.

## Fase 4 — Archivos y herramientas

Cada capacidad se activa con su propio permiso, visible y revocable.

- [ ] Adjuntar archivos e imágenes a un mensaje.
- [ ] Lectura de carpetas elegidas por la persona.
- [ ] Búsqueda web.
- [ ] Servidores MCP: alta, baja y permisos por herramienta.
- [ ] Skills.
- [ ] Aprobación de cada acción sensible desde la interfaz.

## Fase 5 — Distribución

- [ ] Instalador para Windows.
- [ ] macOS y Linux.
- [ ] Resolver cómo llega el motor a quien instala: incluido, descargado al primer arranque o instalado aparte.
- [ ] Actualizaciones automáticas.
- [ ] Interfaz en inglés además de español.

## Más adelante

- Entrada y salida de audio.
- Proyectos: chats agrupados con instrucciones y archivos propios.
- Motor alternativo que hable directo con los proveedores, sin OpenCode.
