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
