import type { Metadata } from "next";
import { requireRole } from "@/lib/dal";
import { Role } from "@/generated/prisma/enums";
import { PortalShell, PageHeader, type NavItem } from "@/components/portal/portal-shell";
import { Card, CardTitle } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Install BusGuard" };

/**
 * Installation instructions, aimed at the three people who will actually be
 * holding the phone: a driver, a student, a parent.
 *
 * Why a page rather than a README: a README is read by whoever deploys the
 * system. The instructions that matter are read by a driver standing at a bus
 * stop, and they will never open a repository. The step that reliably fails is
 * the very first one — installing a PWA on iOS, which requires Share > Add to
 * Home Screen and not "Add to Home Screen" from the menu — so it is stated
 * explicitly rather than implied.
 */
export default async function InstallPage() {
  await requireRole(Role.DRIVER, Role.STUDENT, Role.PARENT, Role.ADMIN);

  const nav: NavItem[] = [{ href: "/", label: "Back to dashboard", icon: "overview" }];

  return (
    <PortalShell userName="Install" roleLabel="Getting started" nav={nav}>
      <PageHeader
        title="Install BusGuard on your phone"
        description="Installing it puts an icon on your home screen and opens it full screen, which is what lets it keep reporting your position with the screen off."
        icon="install"
      />

      <div className="space-y-6">
        <Card accent="blue">
          <CardTitle icon="phone" tone="blue" size="md" hint="The step most people get stuck on">
            iPhone or iPad, using Safari
          </CardTitle>
          <p className="text-sm text-slate-700">
            Tap the <strong>Share</strong> button in Safari&apos;s bottom toolbar,
            then <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            On iOS there is no &ldquo;Add to Home Screen&rdquo; item in the menu
            bar itself. It only appears inside the Share sheet, which is why
            this is spelled out rather than left as a menu name.
          </p>
        </Card>

        <Card accent="emerald">
          <CardTitle icon="phone" tone="emerald" size="md" hint="Chrome or Edge on Android">
            Android
          </CardTitle>
          <p className="text-sm text-slate-700">
            Open the browser menu, then choose <strong>Install app</strong> or{" "}
            <strong>Add to Home screen</strong>. Accept the confirmation and the
            icon appears on your home screen.
          </p>
        </Card>

        <Card>
          <CardTitle icon="navigate" size="md" hint="Sharing a live location">
            For drivers
          </CardTitle>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>
              Open the driver panel and scroll to <strong>Live location</strong>.
            </li>
            <li>
              Tap <strong>Share my location</strong> and allow location access
              when the browser asks. The prompt names the site — allow it for
              BusGuard.
            </li>
            <li>
              The status badge changes from <em>not sharing</em> to{" "}
              <em>live</em>, and the panel starts showing a position. Parents can
              now see the bus.
            </li>
            <li>
              Tap <strong>Stop sharing</strong> at the end of the trip. Until you
              do, the battery cost continues.
            </li>
          </ol>
          <p className="mt-3 text-xs text-slate-500">
            Sharing needs an <code className="code-inline">https</code>{" "}
            address. Browsers refuse location access on a plain{" "}
            <code className="code-inline">http</code> address, and
            the app will say so rather than failing silently.
          </p>
        </Card>

        <Card>
          <CardTitle icon="users" size="md" hint="Waiting, and arrival alerts">
            For students and parents
          </CardTitle>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>Install the app as above.</li>
            <li>
              Open <strong>Notifications</strong> and tap{" "}
              <strong>Get notifications</strong> to allow lock-screen alerts.
            </li>
            <li>
              On a running trip, use <strong>I am at the stop</strong> so the
              driver knows to expect you.
            </li>
          </ol>
        </Card>
      </div>
    </PortalShell>
  );
}
