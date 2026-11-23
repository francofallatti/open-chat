import { test, expect, seedChat } from "../support/app.js";

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

// En la ventana más angosta, con la barra abierta, al contenido le quedan 448 px.
// Nada de lo que sigue puede quedar cortado por el borde de la ventana.
const insideWindow = (locator) => locator.evaluate((element) => {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight;
});
const noHorizontalOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("ACC-006 en la ventana más angosta un título de chat largo se corta y no empuja el contenido", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 600 });
  const title = "Un título de chat extremadamente largo que no entra ni en la barra lateral ni arriba de la ventana angosta";
  await seedChat(page, title);
  await page.locator("#sessions .session-title").click();

  const chatTitle = page.locator("#chat-title");
  await expect(chatTitle).toHaveText(title);
  expect(await insideWindow(chatTitle), "título dentro de la ventana").toBe(true);
  // Cortado con puntos suspensivos: el texto mide más que su caja.
  expect(await chatTitle.evaluate((element) => element.scrollWidth > element.clientWidth), "título cortado").toBe(true);
  expect(await insideWindow(page.locator("#toggle-sidebar")), "botón de la barra dentro de la ventana").toBe(true);
  await expect(page.locator("#composer")).toBeInViewport({ ratio: 1 });
  expect(await noHorizontalOverflow(page), "sin desborde horizontal").toBe(true);
});

test("ACC-007 en la ventana más angosta el menú de modelos y el diálogo de proveedores entran con la barra abierta", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 600 });
  await expect(page.locator("#sidebar")).toBeInViewport();

  await page.locator("#model-btn").click();
  await expect(page.locator("#model-menu")).toBeVisible();
  expect(await insideWindow(page.locator("#model-menu")), "menú de modelos dentro de la ventana").toBe(true);
  await page.keyboard.press("Escape");

  await page.locator("#providers-btn").click();
  await expect(page.locator("#providers-dialog")).toBeVisible();
  expect(await insideWindow(page.locator("#providers-dialog")), "diálogo dentro de la ventana").toBe(true);
  expect(await noHorizontalOverflow(page), "sin desborde horizontal").toBe(true);
});

test.describe("con una respuesta ancha del modelo de prueba", () => {
  const answer = [
    "Un párrafo antes del código.",
    "",
    "```js",
    "const unaLineaMuyLargaDeCodigo = calcularAlgo(primerArgumentoLargo, segundoArgumentoLargo, tercerArgumentoLargo, cuartoArgumentoLargo);",
    "```",
    "",
    "https://ejemplo.com/una/direccion/muy/larga/sin/espacios/que/no/se/puede/cortar/facilmente/en/ningun/lado/para/probar",
  ].join("\n");
  test.use({ useFakeModel: true, fakeAnswer: answer });

  test("ACC-008 en la ventana más angosta una respuesta con código ancho no ensancha la ventana", async ({ page, fakeModel }) => {
    await page.setViewportSize({ width: 720, height: 600 });
    await page.locator("#model-btn").click();
    await page.locator("#model-search").fill(fakeModel.name);
    await page.locator("#model-list .model-option").first().click();
    await expect(page.locator("#model-label")).toHaveText(fakeModel.name);

    await page.locator("#input").fill("mostrame código");
    await page.locator("#input").press("Enter");
    const code = page.locator("#thread .msg.assistant pre");
    await expect(code).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#thread .msg-error")).toHaveCount(0);
    await expect(page.locator("#sidebar")).toBeInViewport();

    // El bloque de código queda dentro de la ventana y se desplaza dentro de sí mismo.
    const box = await code.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, scrolls: element.scrollWidth > element.clientWidth };
    });
    expect(box.left, "el código no queda bajo la barra").toBeGreaterThanOrEqual(272);
    expect(box.right, "el código no pasa el borde").toBeLessThanOrEqual(720);
    expect(box.scrolls, "el código se desplaza dentro de su bloque").toBe(true);
    // La dirección larga se parte en vez de salirse.
    const prose = await page.locator("#thread .msg.assistant .prose").evaluate((element) => element.getBoundingClientRect().right);
    expect(prose, "el texto no pasa el borde").toBeLessThanOrEqual(720);
    expect(await noHorizontalOverflow(page), "sin desborde horizontal").toBe(true);
    await expect(page.locator("#composer")).toBeInViewport({ ratio: 1 });
  });
});

test("ACC-009 el error al guardar una clave es una alerta enlazada al campo", async ({ page }) => {
  await page.locator("#providers-btn").click();
  await page.locator("#provider-list .provider .button").first().click();
  const key = page.locator("#provider-list .provider-form input");
  await expect(key).toBeFocused();
  // Una clave vacía la rechaza la app sin llamar al proveedor.
  await page.keyboard.press("Enter");

  const problem = page.locator("#provider-list [role='alert']");
  await expect(problem).toHaveText("La clave está vacía");
  const again = page.locator("#provider-list .provider-form input");
  await expect(again).toHaveAttribute("aria-invalid", "true");
  await expect(again).toHaveAttribute("aria-describedby", await problem.getAttribute("id"));
});

test("ACC-010 los avisos y el estado del motor llegan al lector de pantalla", async ({ page }) => {
  const notice = page.locator("#notice");
  await expect(notice).toHaveAttribute("role", "alert");
  await expect(notice).toBeHidden();
  // El aviso se muestra con la función que usa la app para todos sus errores.
  await page.evaluate(() => showNotice("No se pudo enviar: prueba"));
  await expect(page.getByRole("alert")).toHaveText("No se pudo enviar: prueba");

  await expect(page.locator("#status")).toHaveAttribute("role", "status");
  // La región de anuncios existe, no se ve y no ocupa lugar.
  const announcer = page.locator("#announcer");
  await expect(announcer).toHaveAttribute("role", "status");
  const box = await announcer.boundingBox();
  expect(box.width * box.height, "área de la región de anuncios").toBeLessThanOrEqual(1);
});

// Anota lo que pasa por la región de anuncios y los nombres de los puntos
// animados, que duran menos que una consulta desde la suite.
const recordAnnouncements = (page) => page.evaluate(() => {
  const seen = (window.__seen = { announced: [], typing: new Set(), busy: new Set() });
  const read = () => {
    const text = document.querySelector("#announcer").textContent;
    if (text && seen.announced.at(-1) !== text) seen.announced.push(text);
    const name = (node) => `${node.getAttribute("role")}:${node.getAttribute("aria-label")}`;
    document.querySelectorAll("#thread .typing").forEach((node) => seen.typing.add(name(node)));
    document.querySelectorAll("#sessions .busy-dot").forEach((node) => seen.busy.add(name(node)));
  };
  new MutationObserver(read).observe(document.body, { childList: true, subtree: true, characterData: true });
});
const recorded = (page) => page.evaluate(() => ({
  announced: window.__seen.announced, typing: [...window.__seen.typing], busy: [...window.__seen.busy],
}));
const chooseFakeModel = async (page, fakeModel) => {
  await page.locator("#model-btn").click();
  await page.locator("#model-search").fill(fakeModel.name);
  await page.locator("#model-list .model-option").first().click();
  await expect(page.locator("#model-label")).toHaveText(fakeModel.name);
};

test.describe("con el modelo de prueba", () => {
  test.use({ useFakeModel: true });

  test("ACC-011 el lector de pantalla se entera de que el modelo responde y de que terminó", async ({ page, fakeModel }) => {
    await chooseFakeModel(page, fakeModel);
    await recordAnnouncements(page);
    await page.locator("#input").fill("hola");
    await page.locator("#input").press("Enter");

    await expect(page.locator("#announcer")).toHaveText("Respuesta lista", { timeout: 30_000 });
    const seen = await recorded(page);
    expect(seen.announced).toEqual(["El modelo está respondiendo", "Respuesta lista"]);
    // Los puntos animados tienen rol y nombre: sin rol, el nombre no se lee.
    expect(seen.typing).toEqual(["img:El modelo está respondiendo"]);
    expect(seen.busy).toEqual(["img:Respuesta en curso"]);
  });
});

test.describe("con un modelo de prueba que rechaza la petición", () => {
  test.use({ useFakeModel: true, fakeFailure: "Clave de prueba rechazada" });

  test("ACC-012 el error del modelo se anuncia con su mensaje", async ({ page, fakeModel }) => {
    await chooseFakeModel(page, fakeModel);
    await recordAnnouncements(page);
    await page.locator("#input").fill("hola");
    await page.locator("#input").press("Enter");

    const problem = page.locator("#thread .msg-error");
    await expect(problem).toBeVisible({ timeout: 60_000 });
    // El texto propio del error, sin el detalle desplegable del proveedor.
    const message = await problem.evaluate((box) => box.firstChild.textContent);
    await expect(page.locator("#announcer")).toHaveText(`Error: ${message}`);
    expect((await recorded(page)).announced[0]).toBe("El modelo está respondiendo");
  });
});
