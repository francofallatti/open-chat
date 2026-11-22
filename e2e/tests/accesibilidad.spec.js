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
