import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/generated/prisma/enums";
import { requireApiRole } from "@/lib/api-auth";
import { contentDisposition, toCsv, type Cell } from "@/lib/csv";
import {
  getStudentHistoryExportRows,
  STUDENT_HISTORY_COLUMNS,
  validateRange,
} from "@/lib/admin/exports";

/**
 * GET /api/admin/students/[id]/history.csv?from=&to=
 *
 * One student's attendance history as a file.
 *
 * Separate from the whole-register export because the two get used for different
 * jobs: the register answers "how did the fleet do this week", and this answers
 * "why was this one child left behind on Tuesday" - which is the question a
 * parent actually asks, and the one an admin should be able to answer without
 * exporting six figures of everybody else's data first.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(Role.ADMIN);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const search = request.nextUrl.searchParams;
  const range = validateRange(search.get("from"), search.get("to"));
  if (!range.ok) {
    return NextResponse.json(
      { error: range.error },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const history = await getStudentHistoryExportRows(id, range.from, range.to);

  // A 404 rather than an empty file for an id that does not exist. An empty CSV
  // reads as "this student was never picked up", which is a different and much
  // worse thing to tell someone than "that id is wrong".
  if (!history) {
    return NextResponse.json(
      { error: "No such student." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const labels = STUDENT_HISTORY_COLUMNS.map((c) => c.label);
  const csv = toCsv(
    labels,
    history.rows.map((row) =>
      STUDENT_HISTORY_COLUMNS.map((c) => (row as Record<string, unknown>)[c.key] as Cell),
    ),
  );

  // The name goes in the filename. An admin exporting histories for a class gets
  // a Downloads folder of `history-1.csv`, `history-2.csv`, and after the fourth
  // there is no way to tell which child a file is about. `safeDownloadFilename`
  // inside `contentDisposition` strips anything that would break a header.
  return csvResponse(
    csv,
    `navika-history-${history.student.name}-${range.from}-to-${range.to}.csv`,
  );
}

function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(filename),
      // An attendance register is the most sensitive thing this app holds, and
      // neither a browser nor an intermediary cache should keep a copy.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}