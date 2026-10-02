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
