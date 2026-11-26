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

test.describe("con un motor de otra serie", () => {
  test.use({ engineVersion: "9.9.0" });

  test("ARR-003 un motor fuera de la serie probada arranca igual y se avisa", async ({ page }) => {
    await expect(page.locator("#status.ok")).toBeVisible();
    await expect(page.locator("#status-text")).toHaveText("Motor OpenCode 9.9.0 · versión no probada");
    await expect(page.getByRole("alert")).toHaveText(
      /^OpenChat se probó con OpenCode \d+\.\d+\.x y tienes la 9\.9\.0\. Si algo falla, puede deberse a la diferencia de versión\.$/,
    );
    // Es un aviso, no un bloqueo: la app queda lista para escribir.
    await expect(page.locator("#greeting")).toBeVisible();
    await page.locator("#input").fill("hola");
    await expect(page.locator("#send")).toBeEnabled();
  });
});
