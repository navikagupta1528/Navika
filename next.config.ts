import type { NextConfig } from "next";

/**
 * Hosts the dev server may serve dev resources to.
 *
 * Next blocks any request to a `/_next/*` path whose `Origin` is not
 * `localhost`, and a WebSocket handshake always carries one. The check answers a
 * blocked upgrade by calling `res.end("Unauthorized")` on what is a raw socket
 * rather than an HTTP response, so the client sees text where it expected a
 * status line:
 *
 *   WebSocket connection to 'ws://127.0.0.1:3010/_next/hmr?id=...'
 *   failed: Error during WebSocket handshake: net::ERR_INVALID_HTTP_RESPONSE
 *
 * Reading a page over `localhost` never showed this, because `localhost` is on
 * Next's built-in allowlist. Reading the same page over `127.0.0.1` - or from a
 * phone or another machine on the LAN, which is the normal way to check a bus
 * tracker on a device - breaks hot reload, and only hot reload. Page assets load
 * fine, so it presents as "the site works but my edits never show up".
 *
 * Both spellings are listed because they are separate origins to the browser but
 * the same machine to a person. The LAN address cannot be listed here; a dev
 * server reached by IP will need its own hostname added.
 */
const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "::1"],
};

export default nextConfig;