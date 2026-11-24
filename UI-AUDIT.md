# Auditoría de la interfaz

Hallazgos de la revisión de `ui/` con las skills `antislop`, `antislop-ui` y `antislop-human` (ver "Interface work" en [CLAUDE.md](CLAUDE.md)). Se arreglan de a uno, cada uno en su pull request con el caso que lo reproduce. Un número no se reutiliza.

Primera revisión: 20 de noviembre de 2026, leyendo el código y calculando los contrastes. La app no se recorrió a mano.

## Prioridad alta: accesibilidad y función

- [x] **1. Texto gris ilegible** (R-25). `--text-3` daba entre 2.78 y 3.23:1 en tema claro y hasta 3.21:1 en tema oscuro; el mínimo es 4.5:1. Afectaba a "Recientes", el estado del motor, "Aún no hay chats", la nota al pie, el nombre del modelo bajo cada respuesta y los textos de ejemplo de los campos. Caso: `ACC-001`.
- [x] **2. Bordes de campos casi invisibles** (R-25). Los buscadores, el campo de clave y los botones secundarios tenían bordes de 1.2 a 1.7:1 contra su fondo; el mínimo para el borde de un control es 3:1. El cuadro de mensaje tenía el mismo defecto (1.5:1) y se arregló junto. Caso: `ACC-003`.
- [x] **3. El cuadro de mensaje no muestra el foco** (R-32). `#input` tenía `outline: 0` sin un reemplazo visible. Ahora el marco del cuadro lleva un contorno de 2 px en el color de acento cuando el área de texto tiene el foco. Los dos buscadores y el campo de clave, que solo cambiaban el color de un borde de 1 px, usan el mismo contorno. Caso: `ACC-004`.
- [x] **4. Selector de modelo con teclado** (R-32, R-39). Al cerrar con Escape el foco se perdía, las flechas no recorrían la lista, y los roles `listbox` y `option` estaban puestos sobre botones. Ahora el foco se queda en el buscador, las flechas, Inicio y Fin mueven la opción activa, Enter la elige y Escape devuelve el foco al botón. Tab cierra el menú. Casos: `MOD-005` a `MOD-010`.
- [x] **5. Ventana angosta** (R-03). Entre 720 y 760 px de ancho la barra lateral tapaba el botón que la oculta y no se podía cerrar. Ahora la barra nunca se superpone: a cualquier ancho empuja el contenido, que entra en los 448 px que quedan. Caso: `ACC-005`.
- [x] **13. Texto de ejemplo de los buscadores** (R-25). Caso: `ACC-002`. `#model-search` y `#provider-search` no usan `--text-3`: su texto de ejemplo queda con el gris por defecto del navegador (`#757575`), que da 4.37:1 en tema claro y 3.29:1 en tema oscuro; el mínimo es 4.5:1. Lo encontró QA en el pull request del 1, midiendo en la app. `ACC-001` no lo ve porque comprueba los colores definidos y no los elementos en pantalla.

## Prioridad alta: estados y avisos

- [x] **6. Los errores no se anuncian** (R-39). `#notice` y los errores de proveedor no tenían `role="alert"`, y el nombre del indicador de "respondiendo" estaba puesto sobre un `div` sin rol, donde no vale. Ahora los avisos y los errores de proveedor son alertas, el campo de clave queda marcado como inválido y enlazado a su error, y los puntos animados tienen nombre. Una región oculta le dice al lector de pantalla cuándo el modelo empieza a responder y cómo terminó: lista, detenida o con qué error. El estado del motor también se anuncia. Casos: `ACC-009` a `ACC-012`.
- [x] **7. Falta el estado de carga** (R-27). Al abrir un chat, el hilo anterior (o el saludo) seguía en pantalla hasta que llegaban los mensajes del nuevo. Ahora el hilo se vacía al instante y muestra "Cargando el chat…", que también recibe el lector de pantalla. El texto aparece a los 0,2 s para que una carga inmediata no parpadee. Caso: `SES-006`.
- [x] **8. "Copiar respuesta" no confirma** (R-26). El botón de copiar código cambiaba a "Copiado" y el de copiar la respuesta no hacía nada visible. Ahora muestra una marca y la palabra "Copiado" durante 1,4 s, y el lector de pantalla recibe "Respuesta copiada" (o "Código copiado"). Si el portapapeles rechaza la copia, los dos botones muestran un aviso en vez de confirmar. Casos: `CHAT-005` y `CHAT-006`.
- [x] **9. Estados de los controles** (R-39). El chat abierto se veía igual que el que tenía el cursor encima, y en tema claro ninguno de los dos se distinguía del fondo de la barra (el color de realce era el mismo que el del fondo). Ahora el cursor encima y el chat abierto tienen fondos distintos, el abierto va además en negrita y lleva `aria-current`. Todos los botones tienen estado apretado. El campo de clave tiene una etiqueta visible en lugar del texto de ejemplo. Casos: `SES-007`, `ACC-013` y `PROV-003`.

## Prioridad baja: identidad y consistencia

- [ ] **10. Se parece a la app de Claude** (R-30). La paleta crema y carbón usa los mismos tonos y el saludo en serif centrado es el mismo gesto. Decidido el 24 de noviembre de 2026: identidad propia sobre la base actual. Falta aplicarlo: neutros grises con tinte verde y saludo alineado a la izquierda, según [DESIGN.md](DESIGN.md).
- [x] **11. Falta `DESIGN.md`** (R-37). Sin dirección escrita, cada cambio visual era un borrador. Ahora [DESIGN.md](DESIGN.md) fija identidad, carácter, paleta con contraste comprobado, tipografía, forma y movimiento.
- [x] **12. Radios y títulos** (R-11, R-39). Había once radios de borde distintos sin una escala. Ahora son cinco, definidos una sola vez: 6, 8, 12 y 16 px, y el redondo. Con un chat abierto no quedaba ningún `h1`; ahora el título del chat es el `h1` y el saludo lo es en la pantalla inicial. Casos: `ACC-014` y `ACC-015`.
- [x] **14. Falta un control para elegir el tema** (R-21). La app seguía el tema de Windows y no dejaba cambiarlo desde adentro. Ahora hay un selector al pie de la barra lateral con tres opciones (Sistema, Claro, Oscuro) que recuerda la elección. Lo pidió el usuario al revisar el pull request del 2. Casos: `TEMA-001` a `TEMA-005`.

## Notas

- Al arreglar el 1, `--text-3` quedó casi igual a `--text-2` en tema claro (4.65 contra 4.86:1 sobre la barra lateral): el fondo de la barra no deja lugar para un tercer tono más claro que cumpla. La diferencia entre texto secundario y terciario hoy la da el tamaño. Si se quiere recuperar el escalón de color, se decide con el 10 y el 11.
- Sin observaciones: no hay degradados, brillos, insignias ni animaciones de relleno; `prefers-reduced-motion` se respeta; el diálogo de proveedores cierra con Escape.
