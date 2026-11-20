import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Cada caso abre su propia ventana de OpenChat: de a uno, para no pelear por
  // el foco ni saturar al modelo gratuito.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
});
