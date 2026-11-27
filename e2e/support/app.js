// Abre el ejecutable real de OpenChat en un entorno aislado y entrega su ventana
// como `page`. Cada caso arranca con datos vacíos y los borra al terminar.
//
// La ventana es un WebView2: se le pide un puerto de depuración y Playwright se
// conecta por CDP. Por eso la suite solo corre en Windows.

import { test as base, chromium, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
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

// El CLI de OpenCode que usaría la app, en el mismo orden que `locate_cli` en
// src/engine.rs.
function realEngineCli() {
  if (process.env.OPENCHAT_OPENCODE_CLI) return process.env.OPENCHAT_OPENCODE_CLI;
  const bundled = path.join(process.env.LOCALAPPDATA || "", "Programs", "ai.opencode.desktop", "resources", "opencode-cli.exe");
  return existsSync(bundled) ? bundled : "opencode";
}

// Proveedor de modelos local, compatible con la API de OpenAI. Guarda lo que el
// motor le envía y contesta siempre lo mismo: sirve para comprobar qué recibe el
// modelo, sin red ni cupo.
const FAKE_ANSWER = "Respuesta del modelo de prueba.";
const FAKE_EFFORTS = ["minimal", "high", "max"];

async function startFakeModel({ answer, failure, stall, key }) {
  const requests = [];
  const keys = [];
  const state = { interrupted: 0 };
  const server = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { requests.push(JSON.parse(body)); } catch { /* petición sin cuerpo JSON */ }
      const sentKey = (req.headers.authorization || "").replace(/^Bearer /, "");
      keys.push(sentKey);
      const chunk = (delta, finish = null) =>
        `data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", created: 0, model: "fake", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      const rejection = (typeof failure === "string" ? { message: failure } : failure)
        || (key && sentKey !== key ? { message: "Clave incorrecta" } : null);
      if (rejection) {
        res.writeHead(rejection.status ?? 401, { "content-type": "application/json", ...rejection.headers });
        res.end(JSON.stringify({ error: {
          message: rejection.message,
          type: rejection.type ?? "invalid_request_error",
          code: rejection.code ?? "invalid_api_key",
        } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(chunk({ role: "assistant", content: answer }));
      if (stall) {
        // La respuesta queda a medias hasta que el motor corta la conexión.
        res.on("close", () => { state.interrupted += 1; });
        return;
      }
      res.write(chunk({}, "stop"));
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    /** Nombre con el que aparece en el selector de modelos. */
    name: "Modelo de prueba",
    /** Nombre del proveedor en el selector y en el diálogo de proveedores. */
    providerName: "Prueba",
    answer,
    /** Esfuerzos de razonamiento que publica, en el orden del selector. */
    efforts: FAKE_EFFORTS,
    /** Otro modelo del mismo proveedor, que no publica esfuerzos. */
    plainName: "Básico sin esfuerzos",
    /** Cuerpos de las peticiones recibidas, en orden. */
    requests,
    /** Clave con la que llegó cada petición, en orden. */
    keys,
    /** Cuántas respuestas a medias cortó el motor (solo con `fakeStall`). */
    get interrupted() { return state.interrupted; },
    engineConfig: {
      providers: {
        fake: {
          name: "Prueba",
          package: "@opencode/ai/providers/openai-compatible",
          // Con `fakeKey` el proveedor arranca sin clave: se conecta desde el diálogo.
          settings: { ...(key ? {} : { apiKey: "prueba" }), baseURL: `http://127.0.0.1:${server.address().port}/v1` },
          models: {
            fake: {
              name: "Modelo de prueba",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4000 },
              // Sin esta lista el motor le pone `low`, `medium` y `high` por su cuenta.
              variants: FAKE_EFFORTS.map((id) => ({ id, settings: { reasoningEffort: id } })),
            },
            plain: {
              name: "Básico sin esfuerzos",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4000 },
              variants: [],
            },
          },
        },
      },
    },
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
  };
}

export const test = base.extend({
  // Con `test.use({ useFakeModel: true })` el motor arranca con un modelo local,
  // que el caso recibe como `fakeModel`.
  useFakeModel: [false, { option: true }],
  // Con `test.use({ fakeAnswer: "…" })` el modelo de prueba contesta ese texto.
  fakeAnswer: [FAKE_ANSWER, { option: true }],

  // Con `test.use({ fakeFailure: "…" })` el modelo de prueba rechaza cada
  // petición con un 401 y ese mensaje, en vez de contestar.
  // Con un objeto se elige también la forma del rechazo:
  // `{ status, message, type, code, headers }`.
  fakeFailure: [null, { option: true }],
  // Con `test.use({ fakeStall: true })` el modelo de prueba manda el comienzo de
  // la respuesta y no la termina: sirve para detenerla.
  fakeStall: [false, { option: true }],
  // Con `test.use({ fakeKey: "…" })` el proveedor de prueba arranca sin conectar
  // y solo contesta a las peticiones que traen esa clave.
  fakeKey: [null, { option: true }],

  fakeModel: async ({ useFakeModel, fakeAnswer, fakeFailure, fakeStall, fakeKey }, use) => {
    if (!useFakeModel) return use(null);
    const fake = await startFakeModel({ answer: fakeAnswer, failure: fakeFailure, stall: fakeStall, key: fakeKey });
    await use(fake);
    await fake.close();
  },

  // Con `test.use({ engineVersion: "9.9.0" })` el motor informa esa versión en
  // lugar de la suya (ver support/engine-proxy.js).
  engineVersion: [null, { option: true }],

  page: async ({ fakeModel, engineVersion }, use, testInfo) => {
    test.skip(process.platform !== "win32", "La suite maneja WebView2 y solo corre en Windows");
    if (!existsSync(exe)) {
      throw new Error(`No existe ${exe}. Compila con: cargo build --release --features custom-protocol`);
    }

    const dataDir = mkdtempSync(path.join(tmpdir(), "openchat-e2e-"));
    if (fakeModel) {
      // Configuración global del motor aislado (ver `engine_home` en src/engine.rs).
      const configDir = path.join(dataDir, "app", "engine", "config", "opencode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify(fakeModel.engineConfig));
    }
    const engineEnv = {};
    if (engineVersion) {
      // OpenChat arranca este archivo creyendo que es el CLI de OpenCode.
      const launcher = path.join(dataDir, "opencode-cli.cmd");
      const proxy = path.join(repoRoot, "e2e", "support", "engine-proxy.js");
      writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "${proxy}" %*\r\n`);
      engineEnv.OPENCHAT_OPENCODE_CLI = launcher;
      engineEnv.OPENCHAT_E2E_REAL_CLI = realEngineCli();
      engineEnv.OPENCHAT_E2E_ENGINE_VERSION = engineVersion;
    }
    const port = await freePort();
    const child = spawn(exe, [], {
      stdio: "ignore",
      env: {
        ...process.env,
        ...engineEnv,
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
