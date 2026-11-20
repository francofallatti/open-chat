import { test, expect } from "../support/app.js";

test("ARR-001 la app arranca y el motor queda conectado", async ({ page }) => {
  await expect(page).toHaveTitle("OpenChat");
  await expect(page.locator("#status-text")).toHaveText(/^Motor OpenCode \d+\.\d+/);
  await expect(page.locator("#greeting")).toBeVisible();
  await expect(page.locator("#input")).toBeFocused();
});

test("ARR-002 el entorno de pruebas arranca sin chats ni claves del usuario", async ({ page }) => {
  await expect(page.locator("#sessions .sessions-empty")).toHaveText("Aún no hay chats.");
  await expect(page.locator("#sessions .session")).toHaveCount(0);

  await page.locator("#providers-btn").click();
  await expect(page.locator("#provider-list .provider").first()).toBeVisible();
  await expect(page.locator("#provider-list .provider-state")).toHaveCount(0);
});
