import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";

import { isBrowserE2EEnabled } from "../../lib/e2e/guard";

if (!isBrowserE2EEnabled()) {
  throw new Error(
    "Browser E2E server is disabled outside the guarded runtime."
  );
}

const publicURL = new URL(process.env.BETTER_AUTH_URL as string);
const publicPort = Number(publicURL.port || 443);
const internalPort = Number(process.env.KNF_E2E_INTERNAL_PORT ?? "3100");
const certificateDirectory = mkdtempSync(
  path.join(tmpdir(), "knf-browser-e2e-")
);
const keyPath = path.join(certificateDirectory, "localhost-key.pem");
const certificatePath = path.join(certificateDirectory, "localhost-cert.pem");

runOpenSSL(keyPath, certificatePath);

const nextBinary = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next"
);
const nextServer = spawn(
  nextBinary,
  ["start", "--hostname", "127.0.0.1", "--port", String(internalPort)],
  { env: process.env, stdio: "inherit" }
);
nextServer.on("error", (error) => {
  console.error("Failed to start the Next.js server for browser E2E:", error);
  process.exitCode = 1;
  setImmediate(shutdown);
});

const proxy = createServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certificatePath)
  },
  (incoming, outgoing) => {
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port: internalPort,
        path: incoming.url,
        method: incoming.method,
        headers: {
          ...incoming.headers,
          host: publicURL.host,
          "x-forwarded-host": publicURL.host,
          "x-forwarded-proto": "https"
        }
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      }
    );
    upstream.on("error", () => {
      if (!outgoing.headersSent) {
        outgoing.writeHead(503, { "content-type": "text/plain" });
      }
      outgoing.end("Application server is starting.");
    });
    incoming.pipe(upstream);
  }
);

proxy.listen(publicPort, publicURL.hostname);
nextServer.on("exit", (code) => {
  if (code !== null && code !== 0) {
    process.exitCode = code;
  }
  proxy.close();
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  proxy.close();
  nextServer.kill("SIGTERM");
  rmSync(certificateDirectory, { recursive: true, force: true });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  rmSync(certificateDirectory, { recursive: true, force: true });
});

function runOpenSSL(key: string, certificate: string): void {
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:localhost",
      "-keyout",
      key,
      "-out",
      certificate
    ],
    { stdio: "ignore" }
  );
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error("Unable to create the temporary E2E HTTPS certificate.");
  }
}
