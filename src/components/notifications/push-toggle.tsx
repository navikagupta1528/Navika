"use client";

/**
 * Opt-in to lock-screen notifications.
 *
 * Only offered when push is actually configured on the server. Hiding the
 * toggle rather than showing a button that fails is important: a family who
 * taps "enable" and sees nothing arrive concludes the app is broken, and stops
 * trusting the notifications that *are* arriving.
 *
 * The browser permission prompt cannot be triggered from a click the browser
 * did not initiate, so the button is the user gesture and `pushManager.subscribe`
 * runs directly inside its handler.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { subscribePush, unsubscribePush } from "@/app/actions/notifications";
import { cn } from "@/lib/utils";

type State = "off" | "on" | "blocked" | "saving";

/**
 * Whether this browser can deliver push at all.
 *
 * This is genuinely external state - it lives in the browser, and the server has
 * no way to observe it - so it is read through `useSyncExternalStore` rather than
 * guessed during render. That is not a style preference. The previous version of
 * this file computed the answer inline:
 *
 *   supported && vapidPublicKey !== null && typeof window !== "undefined" && ...
 *
 * which is precisely the `typeof window` branch React names in its hydration
 * error. The server has no `window`, so it rendered `null`; the client's first
 * render has one, so it rendered a button. React compares those byte for byte,
 * finds them different, and responds the only way it can - by discarding the
 * server HTML for the whole page and re-rendering it on the client. It did that
 * on every visit to /notifications, in every role, logging a `page-error` each
 * time. The page looked correct; it had simply stopped being server-rendered.
 *
 * `useSyncExternalStore` exists for exactly this. React renders `getServerSnapshot`
 * on the server *and* during the client's hydration pass, so the two agree by
 * construction, then re-renders with `getSnapshot` once hydration is done. The
 * intermediate frame is rendered rather than collapsed, because collapsing it is
 * what made the two sides disagree in the first place.
 *
 * The props half needs no such care: `supported` and `vapidPublicKey` come from
 * the server, so both sides compute the same answer and hiding the toggle for
 * "not configured" is safe on its own.
 */
type Capability = "unknown" | "yes" | "no";

function browserSupportsPush(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/**
 * Nothing to subscribe to: browser support is fixed for the life of the page. A
 * no-op subscribe is what makes the store a read-only view of the environment
 * rather than a second copy of state that could drift.
 */
function subscribeToBrowser(): () => void {
  return () => {};
}

export function PushToggle({
  vapidPublicKey,
  supported,
}: {
  vapidPublicKey: string | null;
  supported: boolean;
}) {
  const [state, setState] = useState<State>("off");
  const [error, setError] = useState<string | null>(null);

  const configured = supported && vapidPublicKey !== null;

  const capability: Capability = useSyncExternalStore(
    subscribeToBrowser,
    () => (configured && browserSupportsPush() ? "yes" : "no"),
    () => (configured ? "unknown" : "no"),
  );

  /**
   * Look for an existing subscription once the browser says it can have one.
   *
   * Gated on `capability === "yes"` rather than on the raw expression, so this
   * never runs against an answer the server could not have produced.
   */
  useEffect(() => {
    if (capability !== "yes") return;

    let cancelled = false;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (!cancelled) setState(subscription ? "on" : "off");
      })
      .catch(() => {
        if (!cancelled) setState("off");
      });

    return () => {
      cancelled = true;
    };
  }, [capability]);

  // Nothing to offer, and provably so: the server knew this too. A greyed-out
  // "Get notifications" invites people to wonder why, and the answer is a server
  // setting they cannot change.
  if (!configured || capability === "no") return null;

  /*
   * Still deciding. A same-shaped empty box rather than `null`, because the button
   * that replaces it is roughly 34px tall, and swapping one for the other in
   * consecutive frames shifts the page under the reader - which is what a
   * layout-shift score measures. `aria-hidden` because an empty box is not
   * content and has nothing to say to a screen reader.
   */
  if (capability === "unknown") {
    return <div className="h-[34px]" aria-hidden />;
  }

  async function enable() {
    setState("saving");
    setError(null);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      // An existing subscription from another browser session is reused rather
      // than replaced, because re-subscribing yields a new endpoint and the old
      // row would linger until the push service expired it.
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(vapidPublicKey!),
        });
      }

      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      const result = await subscribePush({
        endpoint: json.endpoint ?? "",
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      });

      setState(result.ok ? "on" : "off");
      if (!result.ok) setError(result.error ?? "Could not register for notifications.");
    } catch (cause) {
      // A rejected permission is the common case, not an error worth a stack.
      if (isPermissionDenied(cause)) {
        setState("blocked");
        setError("Your browser is blocking notifications for this site.");
      } else {
        setState("off");
        setError("Notifications could not be enabled on this device.");
      }
    }
  }

  async function disable() {
    setState("saving");
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
    await unsubscribePush();
    setState("off");
    setError(null);
  }

  if (state === "on") {
    return (
      <div className="text-right">
        <button
          type="button"
          onClick={() => void disable()}
          className={cn("btn-secondary text-xs", "opacity-90")}
        >
          Notifications on · turn off
        </button>
      </div>
    );
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={() => void enable()}
        disabled={state === "saving" || state === "blocked"}
        className="btn-secondary text-xs"
      >
        {state === "saving" ? "Enabling…" : state === "blocked" ? "Blocked by browser" : "Get notifications"}
      </button>
      {error ? (
        <p className="mt-1 max-w-xs text-[11px] text-slate-500">{error}</p>
      ) : null}
    </div>
  );
}

function isPermissionDenied(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "NotAllowedError";
}

/**
 * VAPID keys are base64url; the Push API wants raw bytes.
 *
 * Returns `ArrayBuffer` rather than `Uint8Array` because TypeScript's DOM lib
 * types `applicationServerKey` as a `BufferSource` over `ArrayBuffer`, and a
 * `Uint8Array` backed by a possibly-shared `ArrayBufferLike` does not satisfy
 * it. Building the array over an explicitly-owned buffer sidesteps that without
 * a cast.
 */
function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}
