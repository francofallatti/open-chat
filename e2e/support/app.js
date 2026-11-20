// Abre el ejecutable real de OpenChat en un entorno aislado y entrega su ventana
// como `page`. Cada caso arranca con datos vacíos y los borra al terminar.
//
// La ventana es un WebView2: se le pide un puerto de depuración y Playwright se
// conecta por CDP. Por eso la suite solo corre en Windows.

import { test as base, chromium, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const exe = process.env.OPENCHAT_EXE || path.join(repoRoot, "target", "release", "openchat.exe");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForCdp(port, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`OpenChat se cerró al arrancar (código ${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch { /* todavía no escucha */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("La ventana de OpenChat no abrió el puerto de depuración");
}

// Los procesos del WebView2 sueltan su perfil un momento después de morir la app.
async function removeDir(dir) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        console.warn(`No se pudo borrar ${dir}: ${error.message}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

export const test = base.extend({
  page: async ({}, use, testInfo) => {
    test.skip(process.platform !== "win32", "La suite maneja WebView2 y solo corre en Windows");
    if (!existsSync(exe)) {
      throw new Error(`No existe ${exe}. Compila con: cargo build --release --features custom-protocol`);
    }

    const dataDir = mkdtempSync(path.join(tmpdir(), "openchat-e2e-"));
    const port = await freePort();
    const child = spawn(exe, [], {
      stdio: "ignore",
      env: {
        ...process.env,
        OPENCHAT_DATA_DIR: path.join(dataDir, "app"),
        WEBVIEW2_USER_DATA_FOLDER: path.join(dataDir, "webview"),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      },
    });

    let browser;
    try {
      await waitForCdp(port, child);
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      // Con un perfil recién creado la ventana tarda un instante en cargar la vista.
      let page;
      await expect
        .poll(() => (page = browser.contexts()[0]?.pages().find((p) => p.url().includes("tauri.localhost"))), {
          message: "no se encontró la ventana de OpenChat entre las páginas del WebView2",
          timeout: 20_000,
        })
        .toBeTruthy();

      await appReady(page);

      await use(page);

      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("pantalla", { body: await page.screenshot(), contentType: "image/png" });
      }
    } finally {
      const engineLog = path.join(dataDir, "app", "server.log");
      if (testInfo.status !== testInfo.expectedStatus && existsSync(engineLog)) {
        await testInfo.attach("server.log", { body: readFileSync(engineLog), contentType: "text/plain" });
      }
      await browser?.close().catch(() => {});
      // /T cierra también el motor, que es hijo de la app.
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      await removeDir(dataDir);
    }
  },
});

export { expect };

/**
 * Espera a que la app termine de arrancar: motor conectado, modelos y lista de
 * chats cargados. Usar también después de `page.reload()`.
 *
 * El estado pasa a "ok" antes de que lleguen los modelos; hasta entonces no se
 * puede enviar, así que no alcanza con mirar el estado.
 */
export async function appReady(page) {
  // El primer arranque del motor en un entorno vacío crea su base de datos.
  await expect(page.locator("#status.ok"), "el motor no llegó a conectarse").toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#model-label"), "no se cargaron los modelos").not.toHaveText("Elegir modelo", { timeout: 30_000 });
  await expect(page.locator("#sessions > *").first(), "no se cargó la lista de chats").toBeAttached({ timeout: 30_000 });
}

/** Crea un chat sin llamar al modelo y recarga la vista para que aparezca. */
export async function seedChat(page, title) {
  await page.evaluate(async (chatTitle) => {
    const { invoke } = window.__TAURI__.core;
    const { models, default: suggested } = await invoke("list_models");
    const model = suggested ?? { id: models[0].id, provider: models[0].provider };
    await invoke("create_chat", { title: chatTitle, model });
  }, title);
  await page.reload();
  await appReady(page);
}
