import { test, expect } from "../support/app.js";

test("PROV-001 el diálogo lista proveedores y se cierra con su botón", async ({ page }) => {
  await page.locator("#providers-btn").click();
  await expect(page.locator("#providers-dialog")).toBeVisible();
  await expect(page.locator("#provider-list .provider").first()).toBeVisible();

  await page.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.locator("#providers-dialog")).toBeHidden();
});

test("PROV-002 la búsqueda filtra proveedores y avisa cuando ninguno coincide", async ({ page }) => {
  await page.locator("#providers-btn").click();
  await expect(page.locator("#provider-list .provider").first()).toBeVisible();
  const total = await page.locator("#provider-list .provider").count();

  await page.locator("#provider-search").fill("deepseek");
  await expect(page.locator("#provider-list .provider-name").first()).toHaveText(/deepseek/i);
  expect(await page.locator("#provider-list .provider").count()).toBeLessThan(total);

  await page.locator("#provider-search").fill("proveedor-que-no-existe-xyz");
  await expect(page.locator("#provider-list .provider")).toHaveCount(0);
  await expect(page.locator("#provider-list .model-empty")).toHaveText("Ningún proveedor coincide.");
});

test("PROV-003 «Conectar» abre el campo para la clave de ese proveedor", async ({ page }) => {
  await page.locator("#providers-btn").click();
  await page.locator("#provider-search").fill("deepseek");
  const provider = page.locator("#provider-list .provider").first();
  const name = (await provider.locator(".provider-name").textContent()).trim();

  await provider.getByRole("button", { name: "Conectar" }).click();

  const key = page.locator("#provider-list .provider-form input");
  await expect(key).toHaveAttribute("type", "password");
  await expect(key).toHaveAttribute("placeholder", `Clave de API de ${name}`);
  await expect(key).toBeFocused();
});
