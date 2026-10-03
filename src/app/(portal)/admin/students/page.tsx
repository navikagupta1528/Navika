import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { getStudentForEdit, listStudents } from "@/lib/admin/queries";
import { getEnrollOptions } from "@/lib/admin/enroll-options";
import { Role } from "@/generated/prisma/enums";
import { describeWindow } from "@/lib/pagination";
import { PageHeader } from "@/components/portal/portal-shell";
import { Pagination } from "@/components/portal/pagination";
import { Card, CardTitle, Badge, StatTile, EmptyState } from "@/components/ui/primitives";
import { EnrollForm } from "@/components/admin/enroll-form";
import { ActionForm } from "@/components/admin/action-form";
import {
  endEnrollment,
  reactivateEnrollment,
  saveEnrollment,
  toggleStudentActive,
} from "@/app/actions/admin/enrollments";
import { ACADEMIC_YEARS, DIRECTION_OPTIONS } from "@/lib/admin/form-defs";

export const metadata = { title: "Students" };

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; edit?: string; page?: string | string[] }>;
}) {
  await requireRole(Role.ADMIN);
  const { q, edit, page: rawPage } = await searchParams;

  /*
   * Search and paging both happen in the database now, so they share one `where`.
   * Filtering in JavaScript after fetching would have meant fetching every
   * student to draw a page of twenty-five.
   */
  const [list, options, editing] = await Promise.all([
    listStudents({ q, page: rawPage }),
    getEnrollOptions(),
    // Looked up by id rather than found in the list: with a paged list, the
    // student you asked to edit is usually not on the page you are looking at.
    edit ? getStudentForEdit(edit) : Promise.resolve(null),
  ]);

  const { students, counts, noParentNames, needsAssignment, page } = list;
  const term = q?.trim() ?? "";

  return (
    <>
      <PageHeader
        title="Students"
        description="Who rides which bus, from which stop, in which direction."
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Students" value={counts.total} tone="violet" />
          <StatTile
            label="With an assignment"
            value={counts.assigned}
            sub={`${counts.unassigned} unassigned`}
            tone={counts.unassigned > 0 ? "amber" : "emerald"}
          />
          <StatTile
            label="No parent linked"
            value={counts.noParent}
            sub={counts.noParent > 0 ? "cannot get alerts" : "all linked"}
            tone={counts.noParent > 0 ? "amber" : "emerald"}
          />
          <StatTile label="Assignments" value={counts.assignments} sub="active enrolments" />
        </div>

        {counts.noParent > 0 ? (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 inset-ring-1 inset-ring-amber-200">
            <p className="font-medium">These students have no parent linked</p>
            <p className="mt-0.5 text-xs">
              Pickup, delay and emergency notifications have nowhere to go without a
              guardian, so this student is effectively untracked:{" "}
              {noParentNames.join(", ")}
              {counts.noParent > noParentNames.length
                ? ` and ${counts.noParent - noParentNames.length} more`
                : ""}
              . They can register as a parent and link the child from the parent portal.
            </p>
          </div>
        ) : null}

        <Card>
          <CardTitle
            hint="One assignment per student per direction per year. The stop must be on the bus's route."
          >
            {editing ? `Edit assignment — ${editing.user.name}` : "New assignment"}
          </CardTitle>

          {editing ? (
            <EnrollForm
              students={options.students}
              buses={options.buses}
              action={saveEnrollment}
              defaultValues={{
                id: editing.enrollments[0]?.id,
                studentId: editing.id,
                busId: editing.enrollments[0]?.bus.id,
                stopId: editing.enrollments[0]?.stop.id,
                direction: editing.enrollments[0]?.direction,
                academicYear: editing.enrollments[0]?.academicYear,
              }}
              academicYears={ACADEMIC_YEARS}
              directionOptions={DIRECTION_OPTIONS}
            />
          ) : (
            <EnrollForm
              students={options.students}
              buses={options.buses}
              action={saveEnrollment}
              academicYears={ACADEMIC_YEARS}
              directionOptions={DIRECTION_OPTIONS}
            />
          )}
        </Card>

        <Card>
          <CardTitle
            hint={describeWindow(page)}
            action={
              <form method="get" className="flex items-center gap-2">
                {edit ? <input type="hidden" name="edit" value={edit} /> : null}
                <label htmlFor="q" className="sr-only">
                  Search students
                </label>
                <input
                  id="q"
                  name="q"
                  defaultValue={q ?? ""}
                  placeholder="Name, roll no, email…"
                  className="field w-56 py-1.5 text-xs"
                />
                <button type="submit" className="btn-secondary px-3 py-1.5 text-xs">
                  Search
                </button>
                {term ? (
                  <Link href="/admin/students" className="btn-ghost px-2 py-1.5 text-xs">
                    Clear
                  </Link>
                ) : null}
              </form>
            }
          >
            All students
          </CardTitle>

          {students.length === 0 ? (
            <EmptyState
              title="No students match"
              description={
                term
                  ? `Nothing found for "${q}". Try a shorter search.`
                  : "No students in the system yet. They register themselves, or the seed data can be re-run."
              }
            />
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[44rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-4 font-medium">Student</th>
                    <th className="py-2 pr-4 font-medium">Department</th>
                    <th className="py-2 pr-4 font-medium">Assignments</th>
                    <th className="py-2 pr-4 font-medium">Guardians</th>
                    <th className="py-2 pr-4 font-medium">Account</th>
                    <th className="py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map((student) => (
                    <tr key={student.id} className="align-top">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-slate-900">{student.user.name}</p>
                        <p className="text-xs text-slate-500">
                          {student.enrollmentNo}
                          {student.yearOfStudy ? ` · year ${student.yearOfStudy}` : ""}
                        </p>
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-slate-600">
                        {student.department ?? "—"}
                      </td>
                      <td className="py-2.5 pr-4">
                        {student.enrollments.length === 0 ? (
                          <span className="text-xs text-amber-700">none</span>
                        ) : (
                          <ul className="space-y-1.5">
                            {student.enrollments.map((e) => (
                              <li key={e.id} className="text-xs">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Badge tone={e.direction === "PICKUP" ? "blue" : "violet"}>
                                    {e.direction === "PICKUP" ? "to college" : "to home"}
                                  </Badge>
                                  <Link
                                    href={`/admin/buses/${e.bus.id}`}
                                    className="font-medium text-slate-900 hover:underline"
                                  >
                                    {e.bus.busNumber}
                                  </Link>
                                  <span className="text-slate-500">at {e.stop.name}</span>
                                </div>
                                <div className="mt-1 flex items-center gap-2">
                                  <span className="text-slate-500">{e.academicYear}</span>
                                  <ActionForm
                                    action={endEnrollment}
                                    hidden={{ id: e.id }}
                                    label="End"
                                    className="btn-ghost px-1.5 py-0.5 text-[11px] text-red-600"
                                    confirm={`End ${student.user.name}'s ${e.direction === "PICKUP" ? "to-college" : "to-home"} assignment? Past attendance is kept.`}
                                    ariaLabel={`End ${student.user.name}'s assignment`}
                                  />
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}

                        {student.endedEnrollments.length > 0 ? (
                          <details className="mt-1.5">
                            <summary className="cursor-pointer text-[11px] text-slate-500">
                              {student.endedEnrollments.length} ended
                            </summary>
                            <ul className="mt-1 space-y-1">
                              {student.endedEnrollments.map((e) => (
                                <li
                                  key={e.id}
                                  className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500"
                                >
                                  <span className="line-through">
                                    {e.bus.busNumber} at {e.stop.name} (
                                    {e.direction === "PICKUP" ? "to college" : "to home"},{" "}
                                    {e.academicYear})
                                  </span>
                                  <ActionForm
                                    action={reactivateEnrollment}
                                    hidden={{ id: e.id }}
                                    label="Restore"
                                    className="btn-ghost px-1.5 py-0.5 text-[11px] text-brand-700"
                                    title="Bring this assignment back into service"
                                    ariaLabel={`Restore ${student.user.name}'s ended assignment`}
                                  />
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-4 text-xs">
                        {student.guardianCount === 0 ? (
                          <span className="text-amber-700">none</span>
                        ) : (
                          <ul className="space-y-0.5 text-slate-600">
                            {student.guardians.map((g) => (
                              <li key={g.id}>
                                {g.user.name}
                                <span className="text-slate-500"> · {g.relation}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        {student.user.isActive ? (
                          <Badge tone="emerald">active</Badge>
                        ) : (
                          <Badge tone="slate">deactivated</Badge>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1">
                          {/*
                            The name is the link to the detail page, not a separate
                            button. Two adjacent buttons that do different things
                            ("Open" vs "Edit assignment") is one click too many for
                            the most common action on this screen.
                          */}
                          <Link
                            href={`/admin/students/${student.id}`}
                            className="text-xs text-slate-500 underline-offset-2 hover:text-brand-700 hover:underline"
                            title="Attendance history"
                          >
                            History
                          </Link>
                          <Link
                            href={`/admin/students?edit=${student.id}`}
                            className="btn-ghost px-2 py-1 text-xs"
                          >
                            {student.enrollments.length > 0 ? "Edit" : "Assign"}
                          </Link>
                          <ActionForm
                            action={toggleStudentActive}
                            hidden={{ id: student.user.id, next: String(!student.user.isActive) }}
                            label={student.user.isActive ? "Disable" : "Enable"}
                            className="btn-ghost px-2 py-1 text-xs"
                            title={
                              student.user.isActive
                                ? "Blocks sign-in but keeps history"
                                : "Restores sign-in"
                            }
                            ariaLabel={`${student.user.isActive ? "Disable" : "Enable"} ${student.user.name}`}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} basePath="/admin/students" params={{ q }} />
        </Card>

        {counts.unassigned > 0 ? (
          <Card>
            <CardTitle hint="Students with no bus — assign them before the next trip.">
              Needs an assignment
            </CardTitle>
            <ul className="flex flex-wrap gap-2">
              {needsAssignment.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/students?edit=${s.id}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:border-brand-300 hover:bg-brand-50"
                  >
                    {s.user.name}
                    <span className="text-slate-500">{s.enrollmentNo}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {counts.unassigned > needsAssignment.length ? (
              <p className="mt-3 text-xs text-slate-500">
                and {counts.unassigned - needsAssignment.length} more — use search to find
                them.
              </p>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
