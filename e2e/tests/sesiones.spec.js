import { test, expect, seedChat, appReady } from "../support/app.js";

test("SES-001 un chat existente aparece en Recientes y se puede abrir", async ({ page }) => {
  await seedChat(page, "chat de prueba");

  const row = page.locator("#sessions .session");
  await expect(row).toHaveCount(1);
  await row.locator(".session-title").click();

  await expect(row).toHaveClass(/active/);
  await expect(page.locator("#chat-title")).toHaveText("chat de prueba");
  await expect(page.locator("#greeting")).toBeHidden();
});

test("SES-002 «Nuevo chat» vuelve a la pantalla inicial", async ({ page }) => {
  await seedChat(page, "chat de prueba");
  await page.locator("#sessions .session-title").click();
  await expect(page.locator("#chat-title")).toHaveText("chat de prueba");

  await page.locator("#new-chat").click();

  await expect(page.locator("#greeting")).toBeVisible();
  await expect(page.locator("#chat-title")).toHaveText("");
  await expect(page.locator("#sessions .session.active")).toHaveCount(0);
});

test("SES-003 eliminar un chat pide confirmación y lo quita de la lista", async ({ page }) => {
  await seedChat(page, "chat a borrar");
  await seedChat(page, "chat que queda");
  await expect(page.locator("#sessions .session")).toHaveCount(2);

  let question = "";
  page.once("dialog", (dialog) => { question = dialog.message(); dialog.accept(); });
  await page.getByRole("button", { name: "Eliminar chat chat a borrar" }).click();

  await expect(page.locator("#sessions .session")).toHaveCount(1);
  await expect(page.locator("#sessions .session-title")).toHaveText("chat que queda");
  expect(question).toContain("chat a borrar");

  // Sigue borrado después de recargar: se eliminó en el motor, no solo en la vista.
  await page.reload();
  await appReady(page);
  await expect(page.locator("#sessions .session-title")).toHaveText("chat que queda");
});

test("SES-004 cancelar la confirmación conserva el chat", async ({ page }) => {
  await seedChat(page, "chat que queda");

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Eliminar chat chat que queda" }).click();

  await expect(page.locator("#sessions .session")).toHaveCount(1);
});

test("SES-005 el botón de la barra lateral la oculta y la vuelve a mostrar", async ({ page }) => {
  await page.locator("#toggle-sidebar").click();
  await expect(page.locator("#app")).toHaveClass(/sidebar-hidden/);
  await page.locator("#toggle-sidebar").click();
  await expect(page.locator("#app")).not.toHaveClass(/sidebar-hidden/);
});

test("SES-006 al abrir un chat el hilo muestra que está cargando hasta que llegan los mensajes", async ({ page }) => {
  await seedChat(page, "chat de prueba");
  // La carga dura menos que una consulta desde la suite: se anota lo que entra al hilo.
  await page.evaluate(() => {
    window.__added = [];
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          window.__added.push({ role: node.getAttribute?.("role"), text: node.textContent, greeting: document.querySelector("#main").classList.contains("empty") });
        }
      }
    }).observe(document.querySelector("#thread"), { childList: true });
  });

  await page.locator("#sessions .session-title").click();
  await expect(page.locator("#chat-title")).toHaveText("chat de prueba");
  await expect(page.locator("#input")).toBeFocused();

  const added = await page.evaluate(() => window.__added);
  // Lo primero que entra al hilo es el aviso de carga, con el saludo ya oculto.
  expect(added[0]).toEqual({ role: "status", text: "Cargando el chat…", greeting: false });
  // Con los mensajes cargados el aviso ya no está.
  await expect(page.locator("#thread .thread-loading")).toHaveCount(0);
});

for (const scheme of ["light", "dark"]) {
  test(`SES-007 el chat abierto se distingue del que tiene el cursor encima (tema ${scheme})`, async ({ page }) => {
    await seedChat(page, "primer chat");
    await seedChat(page, "segundo chat");
    await page.emulateMedia({ colorScheme: scheme });
    const row = (title) => page.locator("#sessions .session").filter({ hasText: title });
    const look = (locator) => locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, weight: Number(style.fontWeight) };
    });

    await row("primer chat").locator(".session-title").click();
    await expect(row("primer chat")).toHaveClass(/active/);
    await row("segundo chat").hover();

    const open = await look(row("primer chat"));
    const hovered = await look(row("segundo chat"));
    const sidebar = await page.locator("#sidebar").evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(hovered.background, "el cursor encima cambia el fondo").not.toBe(sidebar);
    expect(open.background, "el chat abierto cambia el fondo").not.toBe(sidebar);
    expect(open.background, "abierto y con el cursor encima no se ven igual").not.toBe(hovered.background);
    // Además del color, el chat abierto va en negrita.
    expect(open.weight).toBeGreaterThan(hovered.weight);

    // El lector de pantalla recibe cuál es el chat abierto.
    await expect(row("primer chat").locator(".session-title")).toHaveAttribute("aria-current", "page");
    expect(await row("segundo chat").locator(".session-title").getAttribute("aria-current")).toBeNull();
  });
}
