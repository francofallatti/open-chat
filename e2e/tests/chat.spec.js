import { test, expect } from "../support/app.js";

// Texto que identifica al modelo en el selector. Por defecto se usa el que la
// app sugiere en un entorno limpio.
const MODEL = process.env.OPENCHAT_TEST_MODEL;

test("CHAT-001 el botón de enviar se habilita solo cuando hay texto", async ({ page }) => {
  await expect(page.locator("#send")).toBeDisabled();
  await page.locator("#input").fill("   ");
  await expect(page.locator("#send")).toBeDisabled();
  await page.locator("#input").fill("hola");
  await expect(page.locator("#send")).toBeEnabled();
});

test("CHAT-002 enviar un mensaje crea el chat y muestra la respuesta del modelo", { tag: "@modelo" }, async ({ page }) => {
  if (MODEL) {
    await page.locator("#model-btn").click();
    await page.locator("#model-search").fill(MODEL);
    await page.locator("#model-list .model-option").first().click();
  }
  const model = (await page.locator("#model-label").textContent()).trim();

  await page.locator("#input").fill("Responde solo con la palabra: hola");
  await page.locator("#input").press("Enter");

  // El mensaje propio aparece de inmediato y el chat queda en la lista.
  await expect(page.locator("#thread .msg.user")).toHaveText("Responde solo con la palabra: hola");
  await expect(page.locator("#sessions .session.active .session-title")).toHaveText("Responde solo con la palabra: hola");
  await expect(page.locator("#input")).toHaveValue("");
  await expect(page.locator("#stop")).toBeVisible();

  // La respuesta termina: vuelve el botón de enviar.
  await expect(page.locator("#stop")).toBeHidden({ timeout: 90_000 });

  const error = page.locator("#thread .msg-error");
  if (await error.count()) {
    const kind = await error.first().getAttribute("data-kind");
    throw new Error(`El modelo "${model}" devolvió un error de tipo "${kind}": ${(await error.first().textContent()).trim()}`);
  }
  await expect(page.locator("#thread .msg.assistant .prose")).not.toBeEmpty();
  await expect(page.locator("#thread .msg.assistant .msg-model")).toHaveText(model);
  await expect(page.locator("#notice")).toBeHidden();
});

test("CHAT-003 Mayús+Enter agrega un salto de línea y no envía", async ({ page }) => {
  await page.locator("#input").fill("primera línea");
  await page.locator("#input").press("Shift+Enter");
  await page.locator("#input").pressSequentially("segunda línea");

  await expect(page.locator("#input")).toHaveValue("primera línea\nsegunda línea");
  await expect(page.locator("#thread .msg")).toHaveCount(0);
  await expect(page.locator("#sessions .session")).toHaveCount(0);
});
