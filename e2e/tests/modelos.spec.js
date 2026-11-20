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
