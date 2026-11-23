import { test, expect, appReady } from "../support/app.js";

// Fondo de la ventana tal como se ve.
const background = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const option = (page, name) => page.getByRole("radio", { name });
// Se elige con un clic en el texto de la opción, como lo hace una persona: el campo en sí está oculto.
const choose = (page, name) => page.locator("#theme label", { hasText: name }).click();
// Los valores de todos los colores definidos, para comparar dos temas.
const tokens = (page) => page.evaluate(() => {
  const style = getComputedStyle(document.documentElement);
  const names = ["--bg", "--bg-side", "--surface", "--surface-2", "--surface-3", "--side-hover", "--border", "--border-strong",
    "--border-control", "--text", "--text-2", "--text-3", "--accent", "--accent-hover", "--accent-pressed", "--on-accent",
    "--danger", "--danger-bg", "--code-bg", "--shadow"];
  return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]));
});

test("TEMA-001 sin elección la app sigue el tema del sistema", async ({ page }) => {
  await expect(page.getByRole("group", { name: "Tema" })).toBeVisible();
  await expect(option(page, "Sistema")).toBeChecked();

  await page.emulateMedia({ colorScheme: "light" });
  const light = await background(page);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await background(page), "el fondo cambia con el sistema").not.toBe(light);
});

test("TEMA-002 elegir Claro u Oscuro manda sobre el tema del sistema", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  const light = await background(page);
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await background(page);

  // Sistema en oscuro, elección en claro.
  await choose(page, "Claro");
  expect(await background(page)).toBe(light);

  // Sistema en claro, elección en oscuro.
  await page.emulateMedia({ colorScheme: "light" });
  await choose(page, "Oscuro");
  expect(await background(page)).toBe(dark);

  // Volver a Sistema devuelve el control a Windows.
  await choose(page, "Sistema");
  expect(await background(page)).toBe(light);
});

test("TEMA-003 la elección de tema se recuerda al recargar", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await choose(page, "Oscuro");
  const dark = await background(page);

  await page.reload();
  await appReady(page);
  await expect(option(page, "Oscuro")).toBeChecked();
  expect(await background(page)).toBe(dark);
});

test("TEMA-004 el selector de tema se maneja con el teclado y muestra el foco", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await option(page, "Sistema").focus();
  await page.keyboard.press("ArrowRight");
  await expect(option(page, "Claro")).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(option(page, "Oscuro")).toBeChecked();
  await expect(option(page, "Oscuro")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");

  // El foco se ve en la opción: el campo en sí está oculto.
  const ring = await option(page, "Oscuro").evaluate((input) => {
    const style = getComputedStyle(input.nextElementSibling);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(ring.style).not.toBe("none");
  expect(ring.width).toBeGreaterThanOrEqual(2);
  // La opción elegida se distingue por el peso además del color.
  const weight = (name) => option(page, name).evaluate((input) => Number(getComputedStyle(input.nextElementSibling).fontWeight));
  expect(await weight("Oscuro")).toBeGreaterThan(await weight("Claro"));
});

test("TEMA-005 el tema oscuro elegido usa los mismos colores que el del sistema", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const system = await tokens(page);
  await page.emulateMedia({ colorScheme: "light" });
  const lightSystem = await tokens(page);

  await choose(page, "Oscuro");
  expect(await tokens(page)).toEqual(system);
  await page.emulateMedia({ colorScheme: "dark" });
  await choose(page, "Claro");
  expect(await tokens(page)).toEqual(lightSystem);

  // El selector entra en la barra lateral sin cortarse.
  const fits = await page.locator("#theme").evaluate((box) => {
    const rect = box.getBoundingClientRect();
    const side = document.querySelector("#sidebar").getBoundingClientRect();
    return rect.left >= side.left && rect.right <= side.right && [...box.querySelectorAll("span")].every((s) => s.scrollWidth <= s.clientWidth);
  });
  expect(fits, "selector dentro de la barra").toBe(true);
});
