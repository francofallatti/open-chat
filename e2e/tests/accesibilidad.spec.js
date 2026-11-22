import { test, expect } from "../support/app.js";

// Contraste WCAG 2.x entre dos colores "#rrggbb", calculado dentro de la página.
function contrastPairs() {
  const style = getComputedStyle(document.documentElement);
  const token = (name) => style.getPropertyValue(name).trim();
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const pairs = [];
  for (const text of ["--text", "--text-2", "--text-3"]) {
    for (const background of ["--bg", "--bg-side", "--surface", "--surface-2"]) {
      const [light, dark] = [luminance(token(text)), luminance(token(background))].sort((a, b) => b - a);
      pairs.push({ pair: `${text} sobre ${background}`, ratio: (light + 0.05) / (dark + 0.05) });
    }
  }
  return pairs;
}

for (const scheme of ["light", "dark"]) {
  test(`ACC-001 los tres tonos de texto se leen sobre todos los fondos (tema ${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const pairs = await page.evaluate(contrastPairs);

    expect(pairs).toHaveLength(12);
    // 4.5:1 es el mínimo de WCAG AA para texto normal.
    const failing = pairs.filter((p) => p.ratio < 4.5).map((p) => `${p.pair}: ${p.ratio.toFixed(2)}`);
    expect(failing).toEqual([]);
  });
}

// Contraste entre el texto de ejemplo de un campo y el fondo que tiene detrás,
// leídos del elemento en pantalla y no de los colores definidos.
function placeholderContrast(field) {
  const rgb = (color) => color.match(/[\d.]+/g).map(Number);
  const luminance = ([r, g, b]) => {
    const [x, y, z] = [r, g, b].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * x + 0.7152 * y + 0.0722 * z;
  };
  // El fondo es el del primer antepasado que no sea transparente.
  let background = null;
  for (let node = field; node && !background; node = node.parentElement) {
    const [r, g, b, alpha = 1] = rgb(getComputedStyle(node).backgroundColor);
    if (alpha > 0) background = [r, g, b];
  }
  const text = rgb(getComputedStyle(field, "::placeholder").color);
  const [light, dark] = [luminance(text), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

for (const scheme of ["light", "dark"]) {
  test(`ACC-002 el texto de ejemplo de cada campo se lee sobre su fondo (tema ${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const ratio = (selector) => page.locator(selector).evaluate(placeholderContrast);

    expect(await ratio("#input"), "cuadro de mensaje").toBeGreaterThanOrEqual(4.5);

    await page.locator("#model-btn").click();
    expect(await ratio("#model-search"), "buscador de modelos").toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press("Escape");

    await page.locator("#providers-btn").click();
    expect(await ratio("#provider-search"), "buscador de proveedores").toBeGreaterThanOrEqual(4.5);
    await page.locator("#provider-list .provider .button").first().click();
    expect(await ratio("#provider-list .provider-form input"), "campo de clave").toBeGreaterThanOrEqual(4.5);
  });
}
