// Se hace pasar por el CLI de OpenCode para que el motor informe otra versión.
//
// OpenChat lo arranca en lugar del CLI (variable OPENCHAT_OPENCODE_CLI) con
// `serve --hostname 127.0.0.1 --port N`. Este programa arranca el CLI real en
// otro puerto y le pasa todas las peticiones tal cual; solo cambia la versión
// en la respuesta de /api/info. El motor sigue siendo el de verdad.
//
// Lo usa la opción `engineVersion` de support/app.js.

import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import { createServer as createTcpServer } from "node:net";

const realCli = process.env.OPENCHAT_E2E_REAL_CLI;
const version = process.env.OPENCHAT_E2E_ENGINE_VERSION;
const args = process.argv.slice(2);
const portAt = args.indexOf("--port") + 1;
const publicPort = Number(args[portAt]);

const enginePort = await new Promise((resolve, reject) => {
  const probe = createTcpServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const engineArgs = [...args];
engineArgs[portAt] = String(enginePort);
const engine = spawn(realCli, engineArgs, { stdio: "inherit" });
engine.on("exit", (code) => process.exit(code ?? 1));
engine.on("error", (error) => { console.error(`No se pudo ejecutar ${realCli}: ${error.message}`); process.exit(1); });

createServer((req, res) => {
  const isInfo = req.method === "GET" && req.url.split("?")[0] === "/api/info";
  const headers = { ...req.headers, host: `127.0.0.1:${enginePort}` };
  if (isInfo) delete headers["accept-encoding"]; // la respuesta se reescribe: tiene que llegar sin comprimir
  const upstream = request({ host: "127.0.0.1", port: enginePort, method: req.method, path: req.url, headers }, (reply) => {
    if (!isInfo || reply.statusCode !== 200) {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
      return;
    }
    const chunks = [];
    reply.on("data", (chunk) => chunks.push(chunk));
    reply.on("end", () => {
      const body = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.concat(chunks).toString("utf8")), version }));
      const replyHeaders = { ...reply.headers, "content-length": body.length };
      delete replyHeaders["transfer-encoding"];
      res.writeHead(200, replyHeaders);
      res.end(body);
    });
  });
  // Mientras el motor arranca todavía no escucha: OpenChat reintenta.
  upstream.on("error", () => { res.writeHead(502); res.end(); });
  // Si OpenChat corta (detener una respuesta, cerrar el flujo de eventos), se corta también hacia el motor.
  res.on("close", () => upstream.destroy());
  req.pipe(upstream);
}).listen(publicPort, "127.0.0.1");
