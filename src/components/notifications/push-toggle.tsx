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

import { useEffect, useState } from "react";
import { subscribePush, unsubscribePush } from "@/app/actions/notifications";
import { cn } from "@/lib/utils";

type State = "off" | "on" | "blocked" | "saving";

export function PushToggle({
  vapidPublicKey,
  supported,
}: {
  vapidPublicKey: string | null;
  supported: boolean;
}) {
  const [state, setState] = useState<State>("off");
  const [error, setError] = useState<string | null>(null);

  /**
   * Whether the browser can do this at all.
   *
   * Derived during render rather than assigned in an effect. It depends only on
   * props and on the user agent, never on anything asynchronous, so putting it
   * in state would mean an extra render that exists solely to reach a conclusion
   * already available on the first one.
   */
  const available =
    supported &&
    vapidPublicKey !== null &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window;

  useEffect(() => {
    if (!available) return;

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
  }, [available]);

  // Nothing to offer. Returning null rather than a disabled button: a greyed-out
  // "Get notifications" invites people to wonder why, and the answer is a server
  // setting they cannot change.
  if (!available || !vapidPublicKey) {
    return null;
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
