import type { ReactNode } from "react";

/**
 * A table with a consistent header/row layout.
 *
 * Deliberately plain markup rather than a table library: the admin tables need
 * four or five columns, a row of actions, and horizontal scroll on mobile. That
 * is less code by hand than configuring a library for it.
 */
export function DataTable({
  head,
  children,
  empty,
}: {
  head: string[];
  children: ReactNode;
  empty?: ReactNode;
}) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead>
          {/* A rule under the header rather than a filled band. A band would
              have to be painted edge to edge to look deliberate, and the table
              is inset inside a card that already has its own padding - a grey
              block that stops 20px short of the edge reads as a mistake. A
              heavier border says the same thing with no geometry to get wrong. */}
          <tr className="border-b-2 border-slate-200 text-left">
            {head.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={`py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                  i === head.length - 1 ? "pr-4 text-right" : "pr-4"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {children}
        </tbody>
      </table>
      {empty}
    </div>
  );
}

/**
 * One data row.
 *
 * Carries `busguard-row` so the row lights up under the pointer and while focus is
 * inside it. The focus half is the load-bearing one: every row's action is a
 * link, so a keyboard user tabbing down a list needs the row to say which line
 * they are on, and it cannot see a hover state at all.
 */
export function Row({
  children,
}: {
  children: ReactNode;
}) {
  // No zebra striping, deliberately. `busguard-row` lights a row up on hover and
  // on focus-within, and a tinted odd row sits at almost the same value as that
  // hover, so half the rows would swallow the very feedback the class exists to
  // give. `divide-y` in DataTable already supplies the horizontal rhythm.
  return <tr className="busguard-row align-middle">{children}</tr>;
}

export function Cell({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`py-2.5 pr-4 text-slate-700 ${
        align === "right" ? "text-right" : ""
      } ${className ?? ""}`}
    >
      {children}
    </td>
  );
}

/** Row-level actions: edit link plus any inline submit forms. */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <td className="py-2.5 pr-4 text-right whitespace-nowrap">
      <div className="inline-flex items-center gap-2">{children}</div>
    </td>
  );
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-10 text-center text-sm text-slate-500">
        {children}
      </td>
    </tr>
  );
}

/** Small key/value list used on the detail pages. */
export function DetailList({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {item.label}
          </dt>
          <dd className="mt-0.5 text-sm text-slate-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
