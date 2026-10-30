import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The social preview card - what a shared BusGuard link looks like in WhatsApp,
 * Slack, Twitter and Facebook.
 *
 * WHY THIS IS GENERATED RATHER THAN A STATIC PNG
 * ----------------------------------------------
 * A hand-made card goes stale the moment the copy changes, and the copy changed
 * once already (the tagline was rewritten after the rename). Generating it from
 * the same words the page uses means the card cannot disagree with the site it
 * is advertising.
 *
 * The logo is read from disk at module scope rather than per request, because it
 * never changes - and it is inlined as base64 because Satori (the renderer
 * behind `ImageResponse`) has no network or filesystem access of its own.
 *
 * The build prerenders this route, so it costs nothing at runtime.
 */

export const alt = "BusGuard - know where the bus is, and that your child is on it";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const logoData = await readFile(join(process.cwd(), "public/logo.png"), "base64");
  const logoSrc = `data:image/png;base64,${logoData}`;

  const chips = [
    "Live position",
    "Arrival countdown",
    "Pickup records",
    "Missed-bus alert",
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background:
            "linear-gradient(135deg, #0b3b2e 0%, #06503b 45%, #064e3b 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        {/* ---- Brand row ---- */}
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 92,
              height: 92,
              borderRadius: 26,
              background: "#ffffff",
              padding: 10,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} width={72} height={72} alt="" />
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 44,
              fontWeight: 700,
              letterSpacing: "-1px",
            }}
          >
            BusGuard
          </div>
          <div
            style={{
              display: "flex",
              marginLeft: "auto",
              alignItems: "center",
              gap: 12,
              padding: "10px 22px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.12)",
              fontSize: 24,
              color: "#d1fae5",
            }}
          >
            <div
              style={{
                display: "flex",
                width: 14,
                height: 14,
                borderRadius: 999,
                background: "#34d399",
              }}
            />
            Live tracking
          </div>
        </div>

        {/* ---- Headline ---- */}
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: "-2px",
            }}
          >
            <div style={{ display: "flex" }}>Know where the bus is.</div>
            <div style={{ display: "flex", color: "#6ee7b7" }}>
              Know your child is on it.
            </div>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              lineHeight: 1.4,
              color: "#a7f3d0",
              maxWidth: 940,
            }}
          >
            Student-aware bus tracking for schools and colleges - live position,
            arrival alerts and a record of who boarded.
          </div>
        </div>

        {/* ---- Feature chips ---- */}
        <div style={{ display: "flex", gap: 16 }}>
          {chips.map((chip) => (
            <div
              key={chip}
              style={{
                display: "flex",
                padding: "14px 26px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.1)",
                fontSize: 26,
                color: "#ecfdf5",
              }}
            >
              {chip}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
