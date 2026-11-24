# Dirección de diseño de OpenChat

Qué aspecto tiene OpenChat y por qué. Cada cambio visual en `ui/` se apoya en este archivo; si un cambio necesita algo que acá no está, primero se decide y se escribe acá.

Las decisiones de identidad, carácter y neutros las tomó el dueño del proyecto el 24 de noviembre de 2026.

Dial: ENERGY 1 / RHYTHM 1 / MOTION 1

## Estado

Este archivo fija la dirección. La interfaz todavía no la cumple en tres puntos, que se corrigen en el pull request del hallazgo 10 de [UI-AUDIT.md](UI-AUDIT.md):

1. Los neutros de `ui/styles.css` siguen siendo los crema anteriores, no los de la tabla de abajo.
2. El saludo de la pantalla inicial sigue centrado.
3. Falta revisar que ningún texto secundario quede sobre `--surface-3`.

Todo lo demás (acento, tipografías, radios, sombras, movimiento) describe lo que ya está en el código.

## Identidad

OpenChat es un panel de escritorio para conversar con modelos abiertos. Tiene identidad propia: no copia el aspecto de la app de ningún proveedor de modelos.

- **Qué se conserva:** el acento verde, la estructura (barra lateral, columna de lectura, cuadro de mensaje), la escala de radios y los estados de los controles.
- **Qué se cambia:** los neutros crema y carbón cálido, y el saludo en serif centrado en la pantalla. Los dos son el gesto reconocible de la app de Claude.

## Carácter

Cálida y editorial: se lee como un cuaderno, no como un panel de control.

- La calidez la dan la tipografía con serif en los títulos y el aire alrededor del texto. No la da el color de fondo.
- El contenido de la conversación es lo más importante de cada pantalla. La interfaz alrededor se queda callada.
- Una sola nota de color: el verde. Todo lo demás es gris con un tinte de ese mismo verde.

## Color

### Neutros

Grises teñidos hacia el tono del acento. Razón: atan toda la paleta al verde y separan a OpenChat del crema.

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--bg` | `#f7f9f8` | `#222725` | fondo de la ventana |
| `--bg-side` | `#edf1ef` | `#1b1f1d` | barra lateral |
| `--surface` | `#ffffff` | `#2b312e` | cuadro de mensaje, menú, diálogo |
| `--surface-2` | `#edf1ef` | `#353c38` | cursor encima, fuera de la barra |
| `--side-hover` | `#e3e9e6` | `#262b29` | cursor encima, dentro de la barra |
| `--surface-3` | `#d5ddd9` | `#424a46` | control apretado y chat abierto |
| `--code-bg` | `#f0f4f2` | `#1b1f1d` | bloques de código |
| `--border` | `#dbe2df` | `#3a423e` | separadores |
| `--border-strong` | `#c5cfca` | `#505954` | barra de desplazamiento, bordes marcados |
| `--border-control` | `#7f8a85` | `#84908a` | borde de campos y botones |
| `--text` | `#1c2421` | `#ecf1ee` | texto principal |
| `--text-2` | `#525e59` | `#b3bdb8` | texto secundario |
| `--text-3` | `#5a6661` | `#a2ada7` | texto terciario: etiquetas y notas |

### Acento y avisos

No cambian.

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--accent` | `#2f7d6b` | `#4fa894` | botón de enviar, botón principal, foco, estado "conectado" |
| `--accent-hover` | `#27695a` | `#62b8a4` | cursor encima |
| `--accent-pressed` | `#1f5446` | `#7cc9b7` | apretado |
| `--on-accent` | `#ffffff` | `#10201c` | texto sobre el acento |
| `--danger` | `#b3402e` | `#f08b78` | errores y borrar |
| `--danger-bg` | `#fbeeea` | `#3a2622` | fondo de un error |

### Reglas

- El acento va solo en la acción principal de la pantalla, en el anillo de foco y en un estado positivo. No se usa para decorar.
- Sobre `--surface-3` el texto va en `--text`. `--text-3` ahí no llega al mínimo (4.33:1 en claro, 3.94:1 en oscuro).
- El acento como texto va solo sobre `--bg` o `--surface`. Sobre la barra lateral no llega a 4.5:1 en claro (4.32:1).
- `--border-control` marca el borde de un control sobre `--bg`, `--surface` o `--bg-side`. Ahí supera 3:1 en los dos temas.
- Sin degradados, brillos ni fondos con textura.
- Un color nuevo o un par nuevo se comprueba con `python .claude/skills/antislop-human/contrast-check.py "#texto" "#fondo"` antes de entrar.

### Contraste comprobado

Texto normal, mínimo 4.5:1. Peor caso de cada token sobre los fondos donde se usa:

| Par | Claro | Oscuro |
|---|---|---|
| `--text` sobre `--surface-3` | 11.46:1 | 7.99:1 |
| `--text-2` sobre `--surface-3` | 4.89:1 | 4.73:1 |
| `--text-3` sobre `--side-hover` (claro) y `--surface-2` (oscuro) | 4.86:1 | 4.89:1 |
| `--accent` sobre `--bg` (claro) y `--surface` (oscuro) | 4.65:1 | 4.65:1 |
| `--on-accent` sobre `--accent` | 4.92:1 | 5.91:1 |
| `--danger` sobre `--bg-side` (claro) y `--danger-bg` (oscuro) | 5.00:1 | 5.86:1 |

## Tipografía

Fuentes del sistema: la app no descarga ninguna.

| Token | Familia | Uso | Razón |
|---|---|---|---|
| `--sans` | Segoe UI Variable Text | interfaz y texto de la conversación | es la fuente de Windows; la app se siente parte del sistema |
| `--serif` | Iowan Old Style, Palatino Linotype | nombre de la app, saludo, título de un diálogo | es la voz editorial; aparece solo en títulos |
| `--mono` | Cascadia Code | código y claves de API | distingue lo que se copia tal cual |

- La serif no se usa en el texto de las respuestas ni en los controles.
- Tamaños: 15.5 px para la conversación, 14 px para los controles, 12 a 13 px para etiquetas y notas. El saludo va de 28 a 40 px según el ancho.
- Sin mayúsculas con espaciado ancho como estilo de título.

## Forma

- **Radios:** cinco pasos, definidos una sola vez en `ui/styles.css`: 6, 8, 12 y 16 px, y el redondo. No se escribe ningún otro valor (caso `ACC-014`).
- **Sombra:** una sola (`--shadow`), para lo que flota sobre la página: el menú de modelos, el diálogo y el cuadro de mensaje. El resto va plano.
- **Columna de lectura:** 780 px de ancho máximo. Razón: largo de línea cómodo para leer.

## Pantalla inicial

El saludo va en serif, alineado a la izquierda sobre la columna de lectura, pegado al cuadro de mensaje. Razón: es el comienzo de una página de cuaderno, no un cartel centrado.

## Movimiento

Transiciones cortas de estado (cursor encima, apretado, aparición de un aviso) y una sola animación continua: los puntos que laten mientras un modelo está respondiendo. Marcan un estado real y paran cuando termina. Nada se anima al cargar ni al desplazar. Con `prefers-reduced-motion: reduce` no hay movimiento.

## Tema

Claro y oscuro, con los mismos papeles en los dos. La app sigue a Windows y la persona puede fijar uno desde la barra lateral. Los valores del tema oscuro están dos veces en `ui/styles.css`; el caso `TEMA-005` comprueba que coincidan.

## Textos

- En español rioplatense, de vos: "¿En qué te ayudo hoy?".
- Frases cortas que dicen qué pasó y qué se puede hacer: "No se pudo copiar: …".
- Sin emojis ni signos de exclamación.
