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
import { resetStaleSimulationFlags } from "./src/server/simulator-runner";
import { startTripReconciler } from "./src/server/trip-reconciler";

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

  /*
   * Clear simulated flags left over from a previous run of this process.
   *
   * `Bus.isSimulated` is stored, but the thing that makes a bus move is a
   * setInterval held in memory, so a deploy or a crash leaves the flag set and the
   * bus standing still - the fleet screen then shows a "simulated" badge next to a
   * marker that no longer moves, which is exactly the dead-column problem this
   * feature was added to fix.
   *
   * Correct only because there is a single server process. `render.yaml` pins
   * `numInstances: 1` for this reason, and the deploy is one Node process by
   * design; if this app ever scales horizontally this call would have to be
   * replaced by an ownership table or a lease, because one instance clearing
   * another's flags would stop buses that are driving perfectly well.
   */
  await resetStaleSimulationFlags();

  /*
   * Close trips that were started and never finished.
   *
   * A trip left ONGOING by a crashed deploy or a driver whose phone died keeps
   * its bus looking live on the fleet map, blocks that driver from starting the
   * next run, and adds an unfinished run to every attendance report. The boot
   * sweep repairs whatever the previous process left behind, which is the common
   * case, and the interval covers a phone dying while the app is up.
   *
   * A server-side timer for the same reason the simulator has one: a browser tab
   * cannot be trusted to still be running in an hour, and nobody is guaranteed
   * to load a page.
   */
  await startTripReconciler();

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

  /*
   * A port clash is the single most common way this fails to start, and Node's
   * own message for it is close to useless: `EADDRINUSE: address already in use
   * 0.0.0.0:3010`, repeated by an uncaughtException handler, naming neither the
   * process holding the port nor the way out. Someone hitting it has no reason
   * to guess that the fix is a taskkill.
   *
   * So: catch it on the server's own 'error' event, name the likely cause, and
   * print a command that actually resolves it. `listen` only reports failure
   * asynchronously through this event, which is why it needs handling here
   * rather than around the call.
   *
   * This is the *second* line of defence, and the first is Next's own. When the
   * port is held by another `next dev`, Next detects it from its lock file and
   * says so with the PID before this ever runs. What reaches the handler here
   * is the case Next cannot see: the port held by something that is not a dev
   * server — an `npm start` left over from a smoke-test run, or an unrelated
   * app that happens to want 3010.
   *
   * The message names PowerShell because this project is developed on Windows:
   * every setup script here is a `.ps1`, so a POSIX `lsof -i :3010` would be
   * advice the reader cannot run.
   */
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EADDRINUSE") {
      console.error("\n  Server error:\n", error);
      process.exit(1);
    }

    console.error(
      `\n  Port ${port} is already in use.\n` +
        `\n  Almost always another Navika server is still running: a previous\n` +
        `  npm run dev in a terminal you did not close, or an npm start left\n` +
        `  over from a smoke-test or Lighthouse run.\n` +
        `\n  Stop whatever holds it (PowerShell):\n` +
        `    Get-NetTCPConnection -LocalPort ${port} -State Listen |\n` +
        `      ForEach-Object { taskkill /PID $_.OwningProcess /F }\n` +
        `\n  Or run this instance on a different port instead:\n` +
        `    $env:PORT=3011; npm run dev\n`,
    );
    process.exit(1);
  });

  server.listen(port, hostname, () => {
    console.log(
      `\n  Navika ready on http://localhost:${port}` +
        `\n  mode:      ${dev ? "development" : process.env.NODE_ENV}` +
        `\n  realtime:  ${io.engine.clientsCount} client(s) connected\n`,
    );
  });

  // Render, Railway and systemd all send SIGTERM on deploy. Close the realtime
  // connections first so open sockets do not keep the process alive for 30s.
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
