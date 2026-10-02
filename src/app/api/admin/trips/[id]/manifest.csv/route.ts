import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/generated/prisma/enums";
import { requireApiRole } from "@/lib/api-auth";
import { contentDisposition, toCsv, type Cell } from "@/lib/csv";
import { getTripRosterExportRows } from "@/lib/admin/exports";

/**
 * GET /api/admin/trips/[id]/manifest.csv
 *
 * The boarding manifest for one trip: every student on it, in the order they
 * board, with a phone number.
 *
 * This is the sheet a driver prints and carries, so it carries the phone number
 * even though the same data is on screen - paper does not have a refresh button,
 * and the whole point of the printout is the 30 seconds before a phone dies.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(Role.ADMIN);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const manifest = await getTripRosterExportRows(id);

  if (!manifest) {
    return NextResponse.json(
      { error: "No such trip." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const csv = toCsv(
    manifest.columns.map((c) => c.label),
    manifest.rows.map((row) =>
      manifest.columns.map((c) => (row as Record<string, unknown>)[c.key] as Cell),
    ),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(manifest.filename),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}