import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/generated/prisma/enums";
import { requireApiRole } from "@/lib/api-auth";
import { contentDisposition, toCsv, type Cell } from "@/lib/csv";
import {
  ATTENDANCE_COLUMNS,
  getAttendanceExportRows,
  validateRange,
} from "@/lib/admin/exports";

/**
 * GET /api/admin/reports/attendance.csv?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The whole attendance register for a date range, as a file.
 *
 * Public only in the sense that the proxy does not redirect it; the handler
 * guards itself, because `/api` is excluded from the proxy matcher and a caller
 * who guesses this path should get a 401 rather than a file.
 *
 * The date range is validated before anything is queried, and an invalid one is
 * a 400 with a message an admin can act on. Defaulting a bad range to
 * "everything" would be worse than refusing it.
 */
export async function GET(request: NextRequest) {
  const guard = await requireApiRole(Role.ADMIN);
  if (!guard.ok) return guard.response;

  const params = request.nextUrl.searchParams;
  const range = validateRange(params.get("from"), params.get("to"));
  if (!range.ok) {
    return NextResponse.json(
      { error: range.error },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rows = await getAttendanceExportRows(range.from, range.to);

  const csv = toCsv(
    ATTENDANCE_COLUMNS.map((c) => c.label),
    rows.map((row) =>
      ATTENDANCE_COLUMNS.map((c) => (row as Record<string, unknown>)[c.key] as Cell),
    ),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(
        `busguard-attendance-${range.from}-to-${range.to}.csv`,
      ),
      // An attendance register is the most sensitive thing this app holds, and a
      // browser or an intermediary cache must never keep a copy of it.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
