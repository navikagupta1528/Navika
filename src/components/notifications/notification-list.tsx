"use client";

/**
 * The inbox.
 *
 * Reading the inbox is what marks it read, so the button is a single "mark all
 * as read" rather than one per row — but it is still a *button*, and the count
 * of new messages is passed in rather than inferred. An earlier version marked
 * everything read in a mount effect, which quietly swallowed the only signal a
 * parent had that something had changed: the rows all looked read, and nothing
 * said how many were new.
 */

import { useState, useTransition } from "react";
import { markAllReadAction } from "@/app/actions/notifications";
import { Badge, Card, CardTitle, EmptyState } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: Date | string | null;
  createdAt: Date | string;
  /** `data.href` from the database, if the notification links anywhere. */
  href?: string | null;
};

export function NotificationList({
  items,
  newCount,
}: {
  items: NotificationItem[];
  /**
   * How many were unread when the page was rendered.
   *
   * The server marks everything read as it lists, so the rows the client
   * receives all read as read. This is passed separately so the page can still
   * say "3 new" about the ones that *were* new a moment ago — otherwise
   * auto-marking on open would silently swallow the only signal a parent had
   * that something changed.
   */
  newCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [allRead, setAllRead] = useState(false);

  function markEverythingRead() {
    startTransition(async () => {
      await markAllReadAction();
      setAllRead(true);
    });
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        description="You are told when your child is picked up, when the bus reaches your stop, and when a trip is running late."
      />
    );
  }

  const readState = (item: NotificationItem) => allRead || Boolean(item.readAt);

  return (
    <Card>
      <CardTitle
        hint={
          newCount > 0
            ? `${newCount} new ${newCount === 1 ? "message" : "messages"} since you last looked.`
            : undefined
        }
        action={
          newCount > 0 && !allRead ? (
            <button
              type="button"
              onClick={markEverythingRead}
              disabled={pending}
              className="btn-secondary text-xs"
            >
              {pending ? "Marking…" : "Mark all as read"}
            </button>
          ) : newCount > 0 ? (
            <Badge tone="emerald">all read</Badge>
          ) : null
        }
      >
        History
      </CardTitle>

      <ul className="divide-y divide-slate-100" aria-busy={pending}>
        {items.map((item) => {
          const isRead = readState(item);
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <p
                  className={cn(
                    "text-sm",
                    isRead ? "font-medium text-slate-700" : "font-semibold text-slate-900",
                  )}
                >
                  {item.title}
                </p>
                {!isRead ? (
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500"
                    aria-label="unread"
                  />
                ) : null}
              </div>
              <p className="mt-0.5 text-sm text-slate-600">{item.body}</p>
              <p className="mt-1 text-xs text-slate-400">{timeAgo(item.createdAt)}</p>
            </>
          );

          return (
            <li key={item.id} className="px-2 py-3">
              {item.href ? (
                <a href={item.href} className="block hover:opacity-80">
                  {body}
                </a>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
