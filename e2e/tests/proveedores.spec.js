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
  // La etiqueta se ve arriba del campo y le da el nombre; no depende del texto de ejemplo.
  const label = page.locator("#provider-list .provider-form label");
  await expect(label).toBeVisible();
  await expect(label).toHaveText(`Clave de API de ${name}`);
  await expect(label).toHaveAttribute("for", await key.getAttribute("id"));
  await expect(key).toHaveAccessibleName(`Clave de API de ${name}`);
  expect(await key.getAttribute("placeholder"), "sin texto de ejemplo que haga de etiqueta").toBeNull();
  await expect(key).toBeFocused();
});

test.describe("con un proveedor de prueba que exige su clave", () => {
  const KEY = "clave-de-prueba-valida";
  test.use({ useFakeModel: true, fakeKey: KEY });

  // Guarda una clave para el proveedor de prueba desde el diálogo y lo cierra.
  const connect = async (page, fakeModel, key) => {
    await page.locator("#providers-btn").click();
    await page.locator("#provider-search").fill(fakeModel.providerName);
    const provider = page.locator("#provider-list .provider")
      .filter({ has: page.getByText(fakeModel.providerName, { exact: true }) });
    await expect(provider.locator(".provider-state")).toHaveCount(0);
    await provider.getByRole("button", { name: "Conectar" }).click();
    await page.getByLabel(`Clave de API de ${fakeModel.providerName}`).fill(key);
    await page.getByRole("button", { name: "Guardar" }).click();

    // El proveedor queda conectado y el campo de la clave se cierra.
    await expect(provider.locator(".provider-state")).toHaveText("Conectado");
    await expect(provider.getByRole("button", { name: "Cambiar clave" })).toBeVisible();
    await expect(page.locator("#provider-list .provider-form")).toHaveCount(0);
    await page.getByRole("button", { name: "Cerrar" }).click();
  };

  const ask = async (page, fakeModel) => {
    await page.locator("#model-btn").click();
    await page.locator("#model-search").fill(fakeModel.name);
    await page.locator("#model-list .model-option").first().click();
    await expect(page.locator("#model-label")).toHaveText(fakeModel.name);
    await page.locator("#input").fill("hola");
    await page.locator("#input").press("Enter");
  };

  test("PROV-004 guardar una clave válida conecta el proveedor y su modelo responde con ella", async ({ page, fakeModel }) => {
    await connect(page, fakeModel, KEY);
    await ask(page, fakeModel);

    await expect(page.locator("#thread .msg.assistant .prose")).toHaveText(fakeModel.answer, { timeout: 30_000 });
    await expect(page.locator("#thread .msg-error")).toHaveCount(0);
    expect(fakeModel.keys.at(-1), "clave con la que llegó la petición al proveedor").toBe(KEY);
  });

  test("PROV-005 una clave que el proveedor rechaza se nota al enviar: el error manda a revisarla", async ({ page, fakeModel }) => {
    // Al guardar no se consulta al proveedor: la clave se acepta sin validar.
    await connect(page, fakeModel, "clave-equivocada");
    await ask(page, fakeModel);

    const problem = page.locator("#thread .msg-error");
    await expect(problem).toBeVisible({ timeout: 60_000 });
    await expect(problem).toHaveAttribute("data-kind", "auth");
    expect(await problem.evaluate((box) => box.firstChild.textContent))
      .toBe("El proveedor rechazó la clave. Revísala en «Proveedores y claves».");
    await expect(page.locator("#thread .msg.assistant .prose")).toHaveCount(0);
    expect(fakeModel.keys.at(-1), "clave con la que llegó la petición al proveedor").toBe("clave-equivocada");
  });
});
