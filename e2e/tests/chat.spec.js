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

test.describe("con el modelo de prueba", () => {
  test.use({ useFakeModel: true });

  test("CHAT-004 el modelo recibe instrucciones de conversación y no las de programación del motor", async ({ page, fakeModel }) => {
    await page.locator("#model-btn").click();
    await page.locator("#model-search").fill(fakeModel.name);
    await page.locator("#model-list .model-option").first().click();
    await expect(page.locator("#model-label")).toHaveText(fakeModel.name);

    await page.locator("#input").fill("hola, ¿quién sos?");
    await page.locator("#input").press("Enter");
    await expect(page.locator("#thread .msg.assistant .prose")).toHaveText(fakeModel.answer, { timeout: 30_000 });
    await expect(page.locator("#thread .msg-error")).toHaveCount(0);

    // La petición del chat es la que termina con el mensaje de la persona.
    const request = fakeModel.requests.find((r) => JSON.stringify(r.messages.at(-1)).includes("hola, ¿quién sos?"));
    expect(request, "el modelo de prueba no recibió el mensaje").toBeTruthy();
    const system = request.messages.filter((m) => m.role === "system").map((m) => JSON.stringify(m.content)).join("\n");
    expect(system).toContain("OpenChat");
    expect(system).not.toContain("coding agent");
    expect(system).not.toContain("Working in codebases");
    // Solo conversación: la única herramienta es la lectura que exigen los modelos gratuitos.
    expect((request.tools ?? []).map((t) => t.function.name)).toEqual(["read"]);
  });

  // Envía un mensaje y espera la respuesta del modelo de prueba.
  const askFakeModel = async (page, fakeModel) => {
    await page.locator("#model-btn").click();
    await page.locator("#model-search").fill(fakeModel.name);
    await page.locator("#model-list .model-option").first().click();
    await page.locator("#input").fill("hola");
    await page.locator("#input").press("Enter");
    await expect(page.locator("#thread .msg.assistant .prose")).toHaveText(fakeModel.answer, { timeout: 30_000 });
    await expect(page.locator("#stop")).toBeHidden();
  };

  test("CHAT-005 «Copiar respuesta» copia el texto y lo confirma en el botón", async ({ page, fakeModel }) => {
    await askFakeModel(page, fakeModel);
    // El portapapeles se reemplaza para leer qué se copió sin pedir permisos.
    await page.evaluate(() => {
      navigator.clipboard.writeText = async (text) => { window.__copied = text; };
    });

    const copy = page.locator("#thread .msg.assistant .msg-actions button");
    await expect(copy).toHaveAccessibleName("Copiar respuesta");
    await copy.click();

    expect(await page.evaluate(() => window.__copied)).toBe(fakeModel.answer);
    await expect(copy).toHaveText("Copiado");
    await expect(copy).toHaveAccessibleName("Respuesta copiada");
    await expect(page.locator("#announcer")).toHaveText("Respuesta copiada");
    // La confirmación es pasajera: el botón vuelve a su estado inicial.
    await expect(copy).toHaveAccessibleName("Copiar respuesta", { timeout: 5_000 });
    await expect(copy).toHaveText("");
  });

  test("CHAT-006 si el portapapeles rechaza la copia se avisa y no se confirma", async ({ page, fakeModel }) => {
    await askFakeModel(page, fakeModel);
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => { throw new Error("portapapeles no disponible"); };
    });

    const copy = page.locator("#thread .msg.assistant .msg-actions button");
    await copy.click();

    await expect(page.locator("#notice")).toHaveText("No se pudo copiar: portapapeles no disponible");
    await expect(copy).toHaveAccessibleName("Copiar respuesta");
    await expect(copy).toHaveText("");
  });
});
