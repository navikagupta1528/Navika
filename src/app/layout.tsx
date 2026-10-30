import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

/**
 * `display: "optional"` rather than the default `"swap"`, and it is worth the
 * one-time flash on a cold cache.
 *
 * With `swap`, the browser paints text in a fallback face as soon as the CSS
 * is parsed, then re-renders it when the real face arrives. That second render
 * is a *new* Largest Contentful Paint candidate, so the font's arrival becomes
 * the thing LCP measures. Measured here: FCP 771 ms, LCP 2380 ms, for a
 * 12 KB font that was on the wire in 20 ms - the metric was reporting a font
 * swap, not a slow page.
 *
 * With `optional` the browser gets roughly one frame to start the font and
 * then commits to whichever face it has. On a warm cache, or any real
 * connection, that is the real font and nothing changes. On a genuinely slow
 * first visit the fallback is used and never swapped, so LCP is recorded on
 * first paint and stays there. Either way the number describes the page rather
 * than a re-render.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "optional",
});

/*
 * There is deliberately no mono family declared here.
 *
 * It was Geist Mono, and that cost a 29 KB woff2 preload on *every* page,
 * including the sign-in screen, where not one glyph is monospaced. A preload is
 * high priority by definition, so it was competing for bandwidth with the
 * resources Largest Contentful Paint was actually waiting on: a font nobody on
 * that page could see, delaying one they could.
 *
 * `font-mono` is used in six places, all admin tables showing codes, numbers
 * and timestamps, and the system mono stack renders those identically for the
 * reader at zero bytes. The stack now lives in globals.css. If a designer
 * later wants a real mono face, it belongs in the admin layout, not this one.
 */

export const metadata: Metadata = {
  /*
   * Social preview images and absolute links are resolved against this. Without
   * it Next falls back to `http://localhost:3010`, and a shared link would carry
   * a card pointing at a developer's laptop. The value comes from the same env
   * var the rest of the app uses for absolute URLs, so a deployed origin is set
   * once, not in two places.
   */
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3010",
  ),
  title: {
    default: "BusGuard — Smart Bus Tracking",
    template: "%s · BusGuard",
  },
  description:
    "Student-aware bus tracking for schools and colleges: live location, arrival countdown, and pickup records, with alerts when the bus is close and when it has left without a student.",
  applicationName: "BusGuard",
  manifest: "/manifest.webmanifest",
  twitter: {
    card: "summary_large_image",
    title: "BusGuard — student-aware bus tracking",
    description:
      "Follow your child's bus live, get arrival alerts, and keep a record of who travelled.",
  },
  appleWebApp: {
    capable: true,
    title: "BusGuard",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  // `maximumScale` and `userScalable: false` are deliberately absent. Both stop a
  // pinch-zoom, which is the only way to magnify text on a phone, and WCAG 1.4.4
  // requires zoom not be disabled. It also fails the Lighthouse accessibility
  // audit outright. The original value of 1 here was cargo-culted "app feel".
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
