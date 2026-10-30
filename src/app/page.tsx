import type { Metadata } from "next";

import { Landing } from "@/components/marketing/landing";

/**
 * The public front door.
 *
 * A plain Server Component that reads nothing - no cookie, no database, no
 * `headers()`. That is the point: because it takes no dynamic input, the build
 * emits it as static HTML, and the first page a stranger ever sees is served
 * from a file rather than rendered per request.
 *
 * The "signed-in visitors go to their dashboard" rule does *not* live here. It
 * lives in `src/proxy.ts`, which redirects `/` for a caller with a valid cookie
 * before this component is ever reached. Doing it here instead would mean
 * reading the session on the root route, which would make the landing page
 * dynamic and give the first impression a database round trip. See
 * `PUBLIC_LANDING` in the proxy for the full reasoning.
 */
export const metadata: Metadata = {
  /*
   * `absolute` bypasses the root layout's `"%s · BusGuard"` template. Every other
   * page is a section of the product and reads well with the suffix - "Trips ·
   * BusGuard" - but the front door is the one page that should carry the whole
   * name, and the template would render it as "live bus tracking for ... ·
   * BusGuard", saying BusGuard twice.
   */
  title: {
    absolute: "BusGuard — know where the bus is, and that your child is on it",
  },
  description:
    "Student-aware bus tracking for schools and colleges. Follow the bus live, get a countdown to your stop, and see which students boarded - with alerts when the bus is close and when it has left without them.",
  openGraph: {
    title: "BusGuard — student-aware bus tracking",
    description:
      "Follow your child's bus live, get arrival alerts, and keep a record of who travelled. Built for schools, colleges and the transport office.",
    type: "website",
  },
};

export default function RootPage() {
  return <Landing />;
}
