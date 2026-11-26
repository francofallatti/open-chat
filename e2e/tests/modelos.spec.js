import { test, expect, appReady } from "../support/app.js";

test("MOD-001 el selector lista modelos agrupados por proveedor", async ({ page }) => {
  await expect(page.locator("#model-label")).not.toHaveText(/Elegir modelo|Sin modelos disponibles/);

  await page.locator("#model-btn").click();
  await expect(page.locator("#model-menu")).toBeVisible();
  await expect(page.locator("#model-search")).toBeFocused();
  await expect(page.locator("#model-list .model-group").first()).toBeVisible();
  await expect(page.locator("#model-list .model-option[aria-selected='true']")).toHaveCount(1);
});

test("MOD-002 elegir un modelo lo deja seleccionado y cierra el menú", async ({ page }) => {
  await page.locator("#model-btn").click();
  const other = page.locator("#model-list .model-option[aria-selected='false']").first();
  const name = (await other.textContent()).trim();
  await other.click();

  await expect(page.locator("#model-menu")).toBeHidden();
  await expect(page.locator("#model-label")).toHaveText(name);

  // La elección se recuerda al recargar la vista.
  await page.reload();
  await appReady(page);
  await expect(page.locator("#model-label")).toHaveText(name);
});

test("MOD-003 buscar un modelo mal escrito avisa que ninguno coincide", async ({ page }) => {
  await page.locator("#model-btn").click();
  await page.locator("#model-search").fill("modelo-que-no-existe-xyz");

  await expect(page.locator("#model-list .model-option")).toHaveCount(0);
  await expect(page.locator("#model-list .model-empty")).toHaveText("Ningún modelo coincide.");
});

test("MOD-004 Escape cierra el menú de modelos", async ({ page }) => {
  await page.locator("#model-btn").click();
  await expect(page.locator("#model-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#model-menu")).toBeHidden();
});

test("MOD-005 Escape devuelve el foco al botón del selector", async ({ page }) => {
  await page.locator("#model-btn").click();
  await expect(page.locator("#model-search")).toBeFocused();
  await page.keyboard.press("Escape");

  await expect(page.locator("#model-menu")).toBeHidden();
  await expect(page.locator("#model-btn")).toBeFocused();
});

test("MOD-006 las flechas recorren la lista de modelos y Enter elige el activo", async ({ page }) => {
  const active = page.locator("#model-list .model-option.active");
  const options = page.locator("#model-list .model-option");
  await page.locator("#model-btn").click();
  // Al abrir, la opción activa es el modelo en uso.
  await expect(active).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Home");
  await expect(active).toHaveText((await options.nth(0).textContent()).trim());
  await page.keyboard.press("ArrowDown");
  const second = (await options.nth(1).textContent()).trim();
  await expect(active).toHaveCount(1);
  await expect(active).toHaveText(second);
  await page.keyboard.press("ArrowUp");
  await expect(active).toHaveText((await options.nth(0).textContent()).trim());
  await page.keyboard.press("ArrowDown");
  // El foco no sale del buscador mientras se recorre la lista.
  await expect(page.locator("#model-search")).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.locator("#model-menu")).toBeHidden();
  await expect(page.locator("#model-label")).toHaveText(second);
});

test("MOD-008 Tab en el buscador cierra el menú y el foco no queda en la lista", async ({ page }) => {
  // Con el cuadro de mensaje vacío no hay ningún control habilitado después del selector.
  await page.locator("#model-btn").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#model-search")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.locator("#model-menu")).toBeHidden();
  await expect(page.locator("#model-list")).not.toBeFocused();

  // Con Mayús+Tab el menú también se cierra y el foco vuelve al botón.
  await page.locator("#model-btn").click();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#model-menu")).toBeHidden();
  await expect(page.locator("#model-btn")).toBeFocused();
});

test("MOD-009 Enter en el buscador sin coincidencias no envía el mensaje a medio escribir", async ({ page }) => {
  await page.locator("#input").fill("mensaje a medio escribir");
  await page.locator("#model-btn").click();
  await page.locator("#model-search").fill("modelo-que-no-existe-xyz");
  await page.keyboard.press("Enter");

  await expect(page.locator("#input")).toHaveValue("mensaje a medio escribir");
  await expect(page.locator("#thread .msg")).toHaveCount(0);
  await expect(page.locator("#model-search")).toBeFocused();
});

test("MOD-010 el menú de modelos entra en la ventana y recorrerlo no la desplaza", async ({ page }) => {
  await page.locator("#model-btn").click();
  await page.keyboard.press("End");

  const { scrolled, bottom, height } = await page.evaluate(() => ({
    scrolled: document.scrollingElement.scrollTop + document.body.scrollTop,
    bottom: document.querySelector("#model-menu").getBoundingClientRect().bottom,
    height: window.innerHeight,
  }));
  expect(scrolled, "desplazamiento de la ventana").toBe(0);
  expect(bottom, "borde inferior del menú").toBeLessThanOrEqual(height);
  // La última opción quedó a la vista dentro de la lista. Se mide con un píxel
  // de margen: con la pantalla al 150 % el desplazamiento se ajusta a píxeles
  // físicos y la opción puede pasar el borde por una fracción que no se ve.
  const hidden = () => page.evaluate(() => {
    const list = document.querySelector("#model-list").getBoundingClientRect();
    const option = document.querySelector("#model-list .model-option.active").getBoundingClientRect();
    return Math.max(list.top - option.top, option.bottom - list.bottom);
  });
  await expect.poll(hidden, "píxeles de la opción activa fuera de la lista").toBeLessThanOrEqual(1);
});

test("MOD-007 el lector de pantalla recibe una lista de opciones y cuál está activa", async ({ page }) => {
  await page.locator("#model-btn").click();
  const search = page.locator("#model-search");
  const options = page.locator("#model-list [role='option']");

  await expect(search).toHaveAttribute("role", "combobox");
  await expect(search).toHaveAttribute("aria-controls", "model-list");
  await expect(page.locator("#model-list")).toHaveAttribute("role", "listbox");
  // Una opción no puede ser a la vez un botón: el rol contradiría al elemento.
  await expect(page.locator("#model-list button")).toHaveCount(0);
  expect(await options.count()).toBeGreaterThan(0);

  await page.keyboard.press("End");
  const activeId = await page.locator("#model-list .model-option.active").getAttribute("id");
  await expect(search).toHaveAttribute("aria-activedescendant", activeId);
  await expect(options.last()).toHaveAttribute("id", activeId);
});
