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

// Contraste del borde de un control contra su propio fondo y contra el fondo
// que lo rodea, leídos del elemento en pantalla.
function borderContrast(control) {
  const rgb = (color) => color.match(/[\d.]+/g).map(Number);
  const luminance = ([r, g, b]) => {
    const [x, y, z] = [r, g, b].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * x + 0.7152 * y + 0.0722 * z;
  };
  // El fondo es el del primer nodo, desde el dado hacia arriba, que no sea transparente.
  const backgroundFrom = (start) => {
    for (let node = start; node; node = node.parentElement) {
      const [r, g, b, alpha = 1] = rgb(getComputedStyle(node).backgroundColor);
      if (alpha > 0) return [r, g, b];
    }
    return [255, 255, 255];
  };
  const ratio = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  const border = rgb(getComputedStyle(control).borderTopColor);
  return Math.min(ratio(border, backgroundFrom(control)), ratio(border, backgroundFrom(control.parentElement)));
}

for (const scheme of ["light", "dark"]) {
  test(`ACC-003 el borde de cada campo y botón secundario se distingue de su fondo (tema ${scheme})`, async ({ page }) => {
    // Sin animaciones: el borde del cuadro de mensaje cambia de color con una
    // transición y, medido a mitad de camino, da un valor que no es el final.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.emulateMedia({ colorScheme: scheme });
    const ratio = (selector) => page.locator(selector).first().evaluate(borderContrast);

    // 3:1 es el mínimo de WCAG AA para el borde de un control.
    expect(await ratio("#composer"), "cuadro de mensaje").toBeGreaterThanOrEqual(3);

    await page.locator("#model-btn").click();
    expect(await ratio("#model-search"), "buscador de modelos").toBeGreaterThanOrEqual(3);
    await page.keyboard.press("Escape");

    await page.locator("#providers-btn").click();
    expect(await ratio("#provider-search"), "buscador de proveedores").toBeGreaterThanOrEqual(3);
    expect(await ratio("#provider-list .provider .button:not(.primary)"), "botón secundario").toBeGreaterThanOrEqual(3);
    await page.locator("#provider-list .provider .button").first().click();
    expect(await ratio("#provider-list .provider-form input"), "campo de clave").toBeGreaterThanOrEqual(3);
  });
}

// Indicador de foco de un elemento: grosor del contorno y su contraste contra
// el fondo del elemento y contra el fondo que lo rodea. Grosor 0 si no hay.
function focusRing(element) {
  const rgb = (color) => color.match(/[\d.]+/g).map(Number);
  const luminance = ([r, g, b]) => {
    const [x, y, z] = [r, g, b].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * x + 0.7152 * y + 0.0722 * z;
  };
  const backgroundFrom = (start) => {
    for (let node = start; node; node = node.parentElement) {
      const [r, g, b, alpha = 1] = rgb(getComputedStyle(node).backgroundColor);
      if (alpha > 0) return [r, g, b];
    }
    return [255, 255, 255];
  };
  const ratio = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  const style = getComputedStyle(element);
  if (style.outlineStyle === "none") return { width: 0, contrast: 0 };
  const ring = rgb(style.outlineColor);
  return {
    width: parseFloat(style.outlineWidth),
    contrast: Math.min(ratio(ring, backgroundFrom(element)), ratio(ring, backgroundFrom(element.parentElement))),
  };
}

for (const scheme of ["light", "dark"]) {
  test(`ACC-004 el campo que tiene el foco lo muestra con un contorno (tema ${scheme})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.emulateMedia({ colorScheme: scheme });
    const ring = (selector) => page.locator(selector).first().evaluate(focusRing);
    // Al menos 2 px de grosor y 3:1 de contraste, el mínimo de WCAG AA para un indicador.
    const expectRing = async (selector, name) => {
      const { width, contrast } = await ring(selector);
      expect(width, `grosor en ${name}`).toBeGreaterThanOrEqual(2);
      expect(contrast, `contraste en ${name}`).toBeGreaterThanOrEqual(3);
    };

    // El cuadro de mensaje muestra el foco en su marco, no en el área de texto.
    await page.locator("#input").focus();
    await expectRing("#composer", "cuadro de mensaje");
    await page.locator("#new-chat").focus();
    expect((await ring("#composer")).width, "cuadro de mensaje sin foco").toBe(0);

    await page.locator("#model-btn").click();
    await expect(page.locator("#model-search")).toBeFocused();
    await expectRing("#model-search", "buscador de modelos");
    await page.keyboard.press("Escape");

    await page.locator("#providers-btn").click();
    await page.locator("#provider-search").focus();
    await expectRing("#provider-search", "buscador de proveedores");
    await page.locator("#provider-list .provider .button").first().click();
    await expect(page.locator("#provider-list .provider-form input")).toBeFocused();
    await expectRing("#provider-list .provider-form input", "campo de clave");
  });
}

test("ACC-005 en la ventana más angosta el botón de la barra lateral queda a la vista y la oculta", async ({ page }) => {
  // 720 px es el ancho mínimo de la ventana (tauri.conf.json).
  await page.setViewportSize({ width: 720, height: 600 });
  const toggle = page.locator("#toggle-sidebar");
  // El elemento que recibe el clic en el centro del botón es el botón, no la barra.
  const reachable = () => toggle.evaluate((button) => {
    const box = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  });

  await expect(page.locator("#sidebar")).toBeInViewport();
  expect(await reachable(), "botón alcanzable con la barra abierta").toBe(true);

  await toggle.click();
  await expect(page.locator("#sidebar")).not.toBeInViewport();
  expect(await reachable(), "botón alcanzable con la barra oculta").toBe(true);

  await toggle.click();
  await expect(page.locator("#sidebar")).toBeInViewport();
  // Con la barra abierta el cuadro de mensaje sigue entero dentro de la ventana.
  await expect(page.locator("#composer")).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sin desborde horizontal").toBe(true);
});
