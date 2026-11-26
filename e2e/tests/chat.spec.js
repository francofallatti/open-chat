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

// Elige el modelo de prueba y envía un mensaje, sin esperar la respuesta.
const sendToFakeModel = async (page, fakeModel, text = "hola") => {
  await page.locator("#model-btn").click();
  await page.locator("#model-search").fill(fakeModel.name);
  await page.locator("#model-list .model-option").first().click();
  await expect(page.locator("#model-label")).toHaveText(fakeModel.name);
  await page.locator("#input").fill(text);
  await page.locator("#input").press("Enter");
};

test.describe("con un modelo de prueba que no termina de responder", () => {
  test.use({ useFakeModel: true, fakeStall: true });

  test("CHAT-007 «Detener» corta la respuesta en curso y conserva lo que ya llegó", async ({ page, fakeModel }) => {
    await sendToFakeModel(page, fakeModel);
    // Llegó el comienzo de la respuesta y el modelo sigue ocupado.
    await expect(page.locator("#thread .msg.assistant .prose")).toHaveText(fakeModel.answer, { timeout: 30_000 });
    const stop = page.getByRole("button", { name: "Detener" });
    await expect(stop).toBeVisible();
    await expect(page.locator("#send")).toBeHidden();

    await stop.click();

    await expect(stop).toBeHidden();
    await expect(page.locator("#send")).toBeVisible();
    await expect(page.locator("#announcer")).toHaveText("Respuesta detenida");
    // Detener no es un error: queda el texto recibido, sin aviso ni bloque de error.
    await expect(page.locator("#thread .msg.assistant .prose")).toHaveText(fakeModel.answer);
    await expect(page.locator("#thread .msg-error")).toHaveCount(0);
    await expect(page.locator("#notice")).toBeHidden();
    await expect(page.locator("#sessions .busy-dot")).toHaveCount(0);
    // El motor cortó de verdad la petición al modelo.
    await expect.poll(() => fakeModel.interrupted).toBe(1);
  });
});

test.describe("con una respuesta con código y un enlace", () => {
  const code = 'const saludo = "hola";\nconsole.log(saludo);\n';
  const link = "https://ejemplo.com/docs";
  const answer = `Probá esto:\n\n\`\`\`js\n${code}\`\`\`\n\nMás en [la documentación](${link}).`;
  test.use({ useFakeModel: true, fakeAnswer: answer });

  const askForCode = async (page, fakeModel) => {
    await sendToFakeModel(page, fakeModel, "mostrame código");
    await expect(page.locator("#thread .msg.assistant pre")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#stop")).toBeHidden();
  };

  test("CHAT-008 un bloque de código trae su botón «Copiar», que copia solo el código y lo confirma", async ({ page, fakeModel }) => {
    await askForCode(page, fakeModel);
    await expect(page.locator("#thread .msg.assistant pre code")).toHaveText(code.trim());
    // El portapapeles se reemplaza para leer qué se copió sin pedir permisos.
    await page.evaluate(() => {
      navigator.clipboard.writeText = async (text) => { window.__copied = text; };
    });

    const copy = page.locator("#thread .msg.assistant pre button");
    await expect(copy).toHaveText("Copiar");
    await copy.click();

    // Ni el texto de alrededor ni el del propio botón.
    expect(await page.evaluate(() => window.__copied)).toBe(code);
    await expect(copy).toHaveText("Copiado");
    await expect(page.locator("#announcer")).toHaveText("Código copiado");
    // La confirmación es pasajera: el botón vuelve a decir «Copiar».
    await expect(copy).toHaveText("Copiar", { timeout: 5_000 });
  });

  test("CHAT-009 un enlace de la respuesta se le pide al sistema y la ventana no navega", async ({ page, fakeModel }) => {
    await askForCode(page, fakeModel);
    // La vista habla con la app por peticiones a ipc.localhost. La de abrir un
    // enlace se anota y se contesta acá, para que el caso no abra el navegador
    // de quien corre la suite; las demás siguen su camino.
    await page.evaluate(() => {
      const realFetch = window.fetch;
      window.__opened = [];
      window.fetch = function (input, init) {
        if (String(input?.url ?? input) !== "http://ipc.localhost/open_external") return realFetch.call(this, input, init);
        window.__opened.push(JSON.parse(init.body).url);
        return Promise.resolve(new Response("null", { headers: { "Tauri-Response": "ok", "content-type": "application/json" } }));
      };
    });
    const url = page.url();

    await page.locator("#thread .msg.assistant .prose").getByRole("link", { name: "la documentación" }).click();

    await expect.poll(() => page.evaluate(() => window.__opened)).toEqual([link]);
    // La app sigue en su vista, con el chat a la vista, y no abrió otra ventana propia.
    expect(page.url()).toBe(url);
    await expect(page.locator("#thread .msg.assistant pre")).toBeVisible();
    expect(page.context().pages()).toHaveLength(1);
  });
});

test.describe("con un modelo de prueba sin cupo", () => {
  // Lo que contesta un proveedor compatible con OpenAI cuando se acabó el cupo.
  test.use({
    useFakeModel: true,
    fakeFailure: {
      status: 429,
      message: "You exceeded your current quota",
      type: "insufficient_quota",
      code: "insufficient_quota",
      headers: { "retry-after": "1800" },
    },
  });

  test("CHAT-010 el cupo agotado se explica con el tiempo de espera y el detalle del proveedor", async ({ page, fakeModel }) => {
    await sendToFakeModel(page, fakeModel);

    const problem = page.locator("#thread .msg-error");
    await expect(problem).toBeVisible({ timeout: 60_000 });
    await expect(problem).toHaveAttribute("data-kind", "quota");
    // El texto propio del error, sin la espera ni el detalle desplegable.
    expect(await problem.evaluate((box) => box.firstChild.textContent))
      .toBe("Se agotó el cupo de este modelo. Cambia de modelo o conecta un proveedor con tu propia clave.");
    await expect(problem.locator("small")).toHaveText("Vuelve a estar disponible en unos 30 min.");
    await expect(problem.locator("details summary")).toHaveText("Detalle del proveedor");
    await expect(problem.locator("details div")).toHaveText("You exceeded your current quota");
    // No se reintenta solo ni queda esperando: se puede volver a escribir.
    await expect(page.locator("#stop")).toBeHidden();
    await expect(page.locator("#send")).toBeVisible();
    expect(fakeModel.requests).toHaveLength(1);
  });
});
