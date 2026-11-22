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
