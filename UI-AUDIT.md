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
- [ ] **7. Falta el estado de carga** (R-27). Al abrir un chat el hilo queda en blanco hasta que llegan los mensajes.
- [ ] **8. "Copiar respuesta" no confirma** (R-26). El botón de copiar código sí lo hace.
- [ ] **9. Estados de los controles** (R-39). El chat activo se ve igual que el que tiene el cursor encima y no lleva `aria-current`. Ningún control tiene estado `:active`. El campo de clave no tiene etiqueta visible.

## Prioridad baja: identidad y consistencia

- [ ] **10. Se parece a la app de Claude** (R-30). La paleta crema y carbón usa los mismos tonos y el saludo en serif centrado es el mismo gesto. Falta decidir si se mantiene o se le da identidad propia.
- [ ] **11. Falta `DESIGN.md`** (R-37). Sin dirección escrita, cada cambio visual es un borrador.
- [ ] **12. Radios y títulos** (R-11, R-39). Hay nueve radios de borde distintos sin una escala, y no queda ningún `h1` cuando hay un chat abierto.
- [ ] **14. Falta un control para elegir el tema** (R-21). La app sigue el tema de Windows y no deja cambiarlo desde adentro. Falta un control con tres opciones (claro, oscuro, seguir al sistema) que recuerde la elección. Lo pidió el usuario al revisar el pull request del 2.

## Notas

- Al arreglar el 1, `--text-3` quedó casi igual a `--text-2` en tema claro (4.65 contra 4.86:1 sobre la barra lateral): el fondo de la barra no deja lugar para un tercer tono más claro que cumpla. La diferencia entre texto secundario y terciario hoy la da el tamaño. Si se quiere recuperar el escalón de color, se decide con el 10 y el 11.
- Sin observaciones: no hay degradados, brillos, insignias ni animaciones de relleno; `prefers-reduced-motion` se respeta; el diálogo de proveedores cierra con Escape.
