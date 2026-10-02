/**
 * Checks that the Dockerfile's runtime stage would actually boot.
 *
 * A missing COPY in a Dockerfile is invisible in review and fatal in
 * production: the image builds fine, then dies on startup with
 * `Cannot find module`, and the first person to find out is whoever is on call.
 * This script makes that failure mode loud and local instead.
 *
 * How it works: parse the runtime stage's COPY lines, materialise exactly those
 * entries into a throwaway directory (node_modules is junctioned rather than
 * copied, because 500 MB of it would cost more than it is worth), then boot the
 * production server from there and require a 200 from /api/health.
 *
 * This is not a substitute for `docker build`. It does not exercise the base
 * image, the apt packages, the non-root user, or the HEALTHCHECK. It checks the
 * one thing a Dockerfile most often gets wrong and a reader is least likely to
 * notice.
 */
import "dotenv/config";

import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
/**
 * Deliberately outside the repo. The first version put this at
 * `scripts/.runtime-check`, which meant xcopy recursed into the directory it was
 * writing to, and it also left a scratch directory that both eslint and tsc
 * would try to read. Keep it in the OS temp dir.
 */
const STAGE = join(tmpdir(), "navika-runtime-check");
const PORT = "3099";

/**
 * Pulls the runtime stage's copy list straight out of the Dockerfile, rather
 * than restating it here. A hand-maintained copy of the list would drift, and a
 * drifted list is worse than no list: it would keep passing while the Dockerfile
 * broke.
 */
function dockerfileRuntimeCopies(): string[] {
  const text = readFileSync(join(ROOT, "Dockerfile"), "utf8");

  // The runtime stage is the one after `FROM ... AS runtime`.
  const marker = text.search(/^FROM .+ AS runtime$/im);
  if (marker < 0) throw new Error("no `FROM ... AS runtime` stage in the Dockerfile");

  const stage = text.slice(marker);
  const copies: string[] = [];
  // Matches `COPY --from=build --chown=node:node /app/foo ./foo`, tolerating any
  // flags and any number of sources.
  const re = /^COPY\s+(?:--\S+\s+)*\S+\s+(?:\.\/)?(\S+)\s*$/gim;
  for (let m = re.exec(stage); m; m = re.exec(stage)) {
    // Last token is the destination; we only need its basename.
    copies.push(m[1]!.split("/").pop()!);
  }
  if (copies.length === 0) throw new Error("the runtime stage copies nothing");
  return copies;
}

function main() {
  const copies = dockerfileRuntimeCopies();
  console.log(`Dockerfile runtime stage copies ${copies.length} entries:`);
  console.log(`  ${copies.join(", ")}\n`);

  const missing = copies.filter((name) => !existsSync(join(ROOT, name)));
  if (missing.length > 0) {
    throw new Error(
      `the Dockerfile copies ${missing.join(", ")}, which ${missing.length === 1 ? "does" : "do"} not exist in the repo. ` +
        `That is a build failure waiting to happen.`,
    );
  }
  console.log("all of them exist in the working tree\n");

  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });

  for (const name of copies) {
    const from = join(ROOT, name);
    const to = join(STAGE, name);
    if (name === "node_modules") {
      // Junction, not a copy: half a gigabyte is a poor price for a smoke test.
      symlinkSync(from, to, "junction");
      continue;
    }
    // `cpSync` rather than shelling out to xcopy, so a failure throws here
    // rather than in an unawaited child process's exit handler.
    cpSync(from, to, { recursive: true });
    console.log(`  copied ${name}`);
  }

  console.log("\nmaterialised. Booting the production server from that tree...\n");
  runProductionServer();
}

function runProductionServer() {
  const child = spawn(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "server.ts", "--prod"], {
    cwd: STAGE,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT,
      HOSTNAME: "127.0.0.1",
      // The runtime stage has no .env, exactly as the image does not. Credentials
      // come from the platform, so this has to be passed in.
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? `http://127.0.0.1:${PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (d) => (log += String(d)));
  child.stderr.on("data", (d) => (log += String(d)));

  const deadline = Date.now() + 90_000;
  const finish = (code: number) => {
    console.log(log.trim());
    console.log("");
    if (code === 0) {
      console.log(
        "PASS  the runtime tree boots and serves, so nothing the server needs is\n" +
          "      missing from the Dockerfile's COPY list.",
      );
    }
    // Always leave the tree behind for inspection, but do not keep a server
    // running after this script exits.
    child.kill("SIGKILL");
    process.exit(code);
  };

  const poll = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      const body = await res.text();
      console.log(`GET /api/health -> ${res.status} ${body}`);
      if (res.status !== 200) {
        console.log("\nFAIL  the tree booted but the database is not reachable.");
        console.log("      That is an environment problem, not a Dockerfile problem.");
        finish(1);
        return;
      }
      finish(0);
      return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) {
      console.log("FAIL  the server never answered within 90s. Output above.");
      finish(1);
      return;
    }
    setTimeout(poll, 1000);
  };

  child.on("exit", (code) => {
    console.log(log.trim());
    console.log(`\nFAIL  the server exited on its own with code ${code}.`);
    finish(1);
  });

  setTimeout(poll, 3000);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (existsSync(STAGE)) {
    console.error(`\nLeftover tree for inspection: ${STAGE}`);
    console.error(`Contents: ${readdirSync(STAGE).join(", ")}`);
  }
  process.exit(1);
}
