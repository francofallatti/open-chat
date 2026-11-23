"use strict";

// Tema elegido por la persona: "light", "dark" o "system" (seguir a Windows).
// Se carga en el <head> para aplicar la elección antes de dibujar la ventana.
const THEME_KEY = "openchat.theme";

function savedTheme() {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    return theme === "light" || theme === "dark" ? theme : "system";
  } catch {
    return "system"; // sin almacenamiento se sigue al sistema
  }
}

// Con "system" no se marca nada y manda la preferencia de Windows (ver styles.css).
function applyTheme(theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function chooseTheme(theme) {
  applyTheme(theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* vale solo para esta sesión */ }
}

applyTheme(savedTheme());
