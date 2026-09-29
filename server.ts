/**
 * Navika custom server.
 *
 * Next.js renders and routes everything as usual; Socket.IO is attached to the
 * same HTTP server so that one port serves both the pages and the live
 * location stream. Deploying to a Node host (Render, Railway, Fly, a VPS) is
 * therefore all that is needed — Socket.IO does not work on Vercel's serverless
 * runtime.
 *
 * This file does NOT go through the Next.js compiler. It runs as plain Node
 * under `tsx`, so it must not import anything from `next/*` internals, React,
 * or Tailwind. Anything shared with the app goes in `src/lib/socket-events.ts`.
 *
 * There is no top-level await here: tsx emits CommonJS for a package without
 * `"type": "module"`, and esbuild rejects top-level await in CJS output.
 */

// Must come first: `src/lib/db.ts` reads DATABASE_URL at module scope, and
// unlike `next dev`, `tsx` does not load .env for us. ES modules evaluate
// imports in source order, so this line runs before the rest.
import "dotenv/config";

import { createServer } from "node:http";
import next from "next";
import { attachSocketServer, setSocketServer } from "./src/server/socket";
import { isSocketRequest } from "./src/lib/socket-events";

// `npm start` passes --prod instead of setting NODE_ENV inline, because
// `NODE_ENV=production node server.js` is not valid in PowerShell or cmd.exe.
// Assign through Object.assign because @types/node marks NODE_ENV readonly.
if (process.argv.includes("--prod")) {
  Object.assign(process.env, { NODE_ENV: "production" });
}

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  /*
   * ORDER MATTERS, and so does the guard below.
   *
   * engine.io registers its own 'request' listener and answers the paths it
   * owns without ever calling the other listeners. Node still invokes ours
   * afterwards, so we must recognise a Socket.IO request and get out of the way
   * — otherwise we try to set headers on a response that is already finished.
   */
  const server = createServer();

  const io = attachSocketServer(server);
  setSocketServer(io);

  server.on("request", (req, res) => {
    if (isSocketRequest(req.url)) return;

    /*
     * Next.js starts writing the response inside handle(), so any header we own
     * has to be set before the call. Once handle() resolves, res.headersSent is
     * already true and further setHeader calls are silently dropped.
     */
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    void handle(req, res);
  });

  server.listen(port, hostname, () => {
    console.log(
      `\n  Navika ready on http://localhost:${port}` +
        `\n  mode:      ${dev ? "development" : process.env.NODE_ENV}` +
        `\n  realtime:  ${io.engine.clientsCount} client(s) connected\n`,
    );
  });

  // Docker and Render send SIGTERM on deploy. Close the realtime connections
  // first so open sockets do not keep the process alive for 30 seconds.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`\n  ${signal} received, shutting down`);
      io.close();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}

main().catch((error) => {
  console.error("\n  Failed to start Navika:\n", error);
  process.exit(1);
});
