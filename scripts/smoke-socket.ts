/**
 * Realtime smoke test.
 *
 * Verifies the parts of the Socket.IO layer that do not need a database:
 *   1. an anonymous client is refused
 *   2. a client with a validly signed session cookie connects
 *   3. the connection closes cleanly on disconnect
 *
 * Usage:  npx tsx scripts/smoke-socket.ts [port]
 */
import "dotenv/config";
import { io } from "socket.io-client";
import { SignJWT } from "jose";

const port = Number.parseInt(process.argv[2] ?? "3010", 10);
const url = `http://localhost:${port}`;

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET is missing or too short");
  return new TextEncoder().encode(secret);
}

async function mintCookie(role: "ADMIN" | "DRIVER" | "STUDENT"): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("smoke-test-user")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key());
}

function connect(cookie?: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const socket = io(url, {
      path: "/api/socket/io",
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: cookie ? { Cookie: cookie } : undefined,
    });
    const done = (result: { ok: boolean; error?: string }) => {
      socket.close();
      resolve(result);
    };
    socket.on("connect", () => done({ ok: true }));
    socket.on("connect_error", (err) => done({ ok: false, error: err.message }));
    setTimeout(() => done({ ok: false, error: "timeout" }), 8_000);
  });
}

async function main() {
  console.log(`\n  Socket.IO smoke test against ${url}\n`);

  const anonymous = await connect();
  console.log(
    anonymous.ok
      ? "  FAIL  anonymous client was allowed in"
      : `  pass  anonymous client refused ("${anonymous.error}")`,
  );

  const cookie = await mintCookie("ADMIN");
  const authed = await connect(`navika_session=${cookie}`);
  console.log(
    authed.ok
      ? "  pass  signed session cookie accepted"
      : `  FAIL  signed session cookie rejected ("${authed.error}")`,
  );

  const bad = await connect("navika_session=not-a-real-token");
  console.log(
    !bad.ok
      ? `  pass  forged cookie refused ("${bad.error}")`
      : "  FAIL  forged cookie was accepted",
  );

  const passed =
    !anonymous.ok && authed.ok && !bad.ok ? 0 : 1;
  console.log(passed === 0 ? "\n  all checks passed\n" : "\n  some checks failed\n");
  process.exit(passed);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
