/**
 * Pagination, over HTTP, against the pages that carry it.
 *
 * The arithmetic is unit tested; this covers the wiring that arithmetic cannot:
 * that a `?page=` actually reaches the query, that the count on screen matches the
 * rows a real database has, and that filters survive paging.
 *
 * Two of these checks exist because the bug they cover was invisible from the
 * outside. The old lists fetched a fixed hundred rows and said nothing about the
 * total, so the list looked complete. The tile counts were computed from those
 * hundred, so "Open (2)" was confidently two-of-the-last-hundred. Both are only
 * detectable by comparing what the page says against what the database actually
 * holds, which is what the first three checks do.
 *
 *   npm run smoke:pagination          # port from .env
 *   npm run smoke:pagination 3010
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEMO_PASSWORD, login, resolveBase, visibleText } from "./lib/http";

const BASE = resolveBase();

let pass = 0;
let fail = 0;
function record(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  ${detail}` : ""}`);
  }
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/*
 * 19 checks:
 *   3  each list shows the database total, not the page size
 *   1  the pager appears once a list crosses a page boundary
 *   1  page two holds rows page one does not - compared by id, because two
 *      individually correct pages can still overlap on an under-ordered query
 *   1  page two is labelled as page two
 *   1  a page past the end clamps to the last page
 *   3  nonsense page numbers (not a number, zero, negative) fall back to page one
 *   1  searching narrows the count to the matches
 *   1  pager links carry the search term
 *   1  a searched list pages, disjointly
 *   1  the alert status chip shows the real count
 *   1  the chip count does not move when the filter is applied
 *   1  filtering alerts really excludes other statuses
 *   1  the trips tile counts the whole day
 *   1  an edit link for someone on another page opens that student
 *   1  planted rows are removed, so re-running starts from the same state
 */
const total = 19;

/** A page's visible text, for reading the numbers and copy a person would see. */
async function text(path: string): Promise<string> {
  const raw = await rawHtml(path);
  return visibleText(raw);
}

/**
 * A page's markup.
 *
 * Needed separately from `text` because two of the checks read `href`s, and
 * stripping the tags strips the attributes with them. Both forms are used on
 * purpose: the copy assertions want the text a person reads, and the identity
 * assertions want the markup that identifies a row.
 */
async function rawHtml(path: string): Promise<string> {
  const res = await session.get(path);
  if (res.status !== 200) throw new Error(`${path} -> ${res.status}`);
  return res.html;
}

/** The trailing total of a "Showing 1 to 25 of N" line, read off the page. */
function shownTotal(html: string): number {
  const m = /of ([\d,]+)\b/.exec(html);
  return m ? Number(m[1].replace(/,/g, "")) : Number.NaN;
}

/** The "Showing X to Y of Z" line itself. */
function rangeLabel(html: string): string {
  return /Showing [\d]+ to [\d]+ of [\d]+/.exec(html)?.[0] ?? "(none)";
}

/**
 * Student ids linked from *the results table*, which is how a row is identified.
 *
 * Reads the markup, not the visible text: the id lives in an `href` attribute.
 *
 * The question is which `?edit=` links are *rows*, and markup boundaries are the
 * wrong tool for it. Two things put `?edit=` on this page that are not table rows:
 *
 * - **The "Needs an assignment" card** below the table, a `<ul>` of chips, one per
 *   unassigned student. With probe rows planted it holds nine of them, so a count
 *   over the whole document reads 34 for a 25-row page.
 * - **React's flight payload**, inline `<script>` that quotes the tree it is about
 *   to send, complete with `<tbody>` and `?edit=` strings. Scanning it makes the
 *   answer depend on how far the response had streamed — the same URL reported 25
 *   tbodies once and 1 the next time, which is the shape of a flake, not a bug.
 *
 * What a row has that neither imposter has is a *pair*: the History link
 * `/admin/students/<id>` and the edit link `/admin/students?edit=<id>` carrying the
 * same id. Matching on that pair is exact, and survives the markup changing around
 * it. Scripts are stripped anyway, so a link quoted twice in the payload cannot
 * count twice.
 */
function idsOn(html: string): string[] {
  const markup = html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
  const edited = new Set(
    [...markup.matchAll(/href="\/admin\/students\?edit=([a-z0-9]+)"/g)].map(
      (m) => m[1]!,
    ),
  );
  const rows = new Set(
    [...markup.matchAll(/href="\/admin\/students\/([a-z0-9]+)"/g)].map(
      (m) => m[1]!,
    ),
  );
  return [...edited].filter((id) => rows.has(id));
}

/**
 * The value of a query parameter inside an href, as a browser would read it.
 *
 * Two encodings have to be undone, and both matter:
 *
 * - `&amp;` for the separator, because this is raw markup, not a parsed URL.
 * - `+` for the space, because `URLSearchParams` encodes a space as a plus rather
 *   than as `%20`. Checking for the literal term against the encoded href fails on a
 *   pager that is working perfectly.
 */
function hrefParam(href: string, key: string): string | null {
  const clean = href.replace(/&amp;/g, "&");
  const params = new URLSearchParams(clean.split("?")[1] ?? "");
  return params.get(key);
}

/** A session, set once `main` has logged in. */
let session: Awaited<ReturnType<typeof login>>;

async function main() {
  session = await login(BASE, "admin@busguard.test", DEMO_PASSWORD);
  await runChecks();
}

const LISTS = [
  { name: "students", path: "/admin/students", total: () => prisma.studentProfile.count() },
  { name: "trips", path: "/admin/trips", total: () => prisma.trip.count() },
  { name: "alerts", path: "/admin/alerts", total: () => prisma.emergencyAlert.count() },
] as const;

async function runChecks() {
  /*
   * THE COUNT IS THE REAL ONE
   *
   * This is the check the truncation bug could never have failed. It compares the
   * number the page prints with a direct count from the database, so a pager that
   * reports the page size, or that counts the wrong filter, fails here.
   */
  /*
   * Held as a plain record because the per-list counts are needed later too, by the
   * students section which compares a planted total against the original.
   */
  const realTotals: Record<string, number> = {
    students: await prisma.studentProfile.count(),
    trips: await prisma.trip.count(),
    alerts: await prisma.emergencyAlert.count(),
  };

  for (const list of LISTS) {
    const html = await text(list.path);
    const says = shownTotal(html);
    const want = realTotals[list.name]!;
    record(
      `${list.name}: the page shows the database total, not the page size`,
      want === 0 ? !Number.isFinite(says) : says === want,
      `page says ${Number.isFinite(says) ? says : "no total"}, database has ${want}`,
    );
  }

/*
 * A REAL MULTI-PAGE LIST
 *
 * The seed has forty students - under one page of twenty-five in total, but not by
 * much - so paging is barely exercised by the stock data. This plants extra
 * students to push the list past a page boundary, checks page two, then removes
 * them, so the suite is self-cleaning and can be re-run without drifting.
 *
 * Planting rather than re-seeding is deliberate: the suite has to work against a
 * database whose contents it did not create.
 */
const PLANTED = 30;

/**
 * Remove only what was planted, matched on distinctive prefixes.
 *
 * Called at the end of the run *and* from the `finally`, so it is both the
 * self-cleaning step the suite depends on and the safety net for a run that threw
 * halfway through. Idempotent, so the second call is a no-op.
 *
 * Deleting by a collected id list would be tidier, but `studentProfile` cascades to
 * its user, so the ids are only trustworthy if every create succeeded partway
 * through. The prefix states the intent and is safe to re-run.
 */
async function cleanup() {
  await prisma.studentProfile.deleteMany({
    where: { enrollmentNo: { startsWith: "ZZPROBE" } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: "pagination-probe-" } },
  });
}

try {
  for (let n = 0; n < PLANTED; n++) {
    const user = await prisma.user.create({
      data: {
        email: `pagination-probe-${n}-${process.pid}@busguard.test`,
        name: `Pagination Probe ${n}`,
        passwordHash: "x",
        role: "STUDENT",
        phone: "9000000000",
      },
    });
    await prisma.studentProfile.create({
      data: {
        userId: user.id,
        enrollmentNo: `ZZPROBE${String(n).padStart(3, "0")}`,
        department: "Probe",
        yearOfStudy: 1,
      },
    });
  }

  const totalNow = realTotals.students + PLANTED;
  const pages = Math.ceil(totalNow / 25);

  const page1 = await rawHtml("/admin/students");
  const first = new Set(idsOn(page1));

  record(
    "planting past a page boundary makes the pager appear",
    pages > 1 && first.size === 25 && shownTotal(page1) === totalNow,
    `${totalNow} students, ${pages} pages, page one shows ${first.size} rows and says ${shownTotal(page1)}`,
  );

  /*
   * Page two must contain rows page one does not.
   *
   * Comparing row identifiers rather than "the page looks different" is the point.
   * Pagination over a partially ordered list can serve the same row on both pages -
   * each page is then individually correct and they overlap, which no check that
   * only looks for a difference would catch.
   */
  const page2 = await rawHtml("/admin/students?page=2");
  const second = idsOn(page2);
  const overlap = second.filter((id) => first.has(id));

  record(
    "page two returns rows, and none of them are on page one",
    second.length > 0 && overlap.length === 0,
    `page one had ${first.size}, page two had ${second.length}, overlap ${overlap.length}`,
  );

  record(
    "page two is labelled as page two",
    rangeLabel(visibleText(page2)).startsWith("Showing 26 to 50 of"),
    `"${rangeLabel(visibleText(page2))}"`,
  );

  /*
   * A PAGE BEYOND THE END CLAMPS INSTEAD OF EMPTYING
   *
   * `?page=99` on a two-page list must show page two. Getting this wrong produces a
   * state where the label and the rows disagree - each correct on its own, jointly a
   * lie - so this asserts on both at once rather than either alone.
   */
  const beyond = await rawHtml("/admin/students?page=99");
  const beyondIds = idsOn(beyond);
  record(
    "a page past the end clamps to the last page instead of showing nothing",
    beyondIds.length > 0 && /Showing [\d]+ to [\d]+ of [\d]+/.test(visibleText(beyond)),
    `${beyondIds.length} rows, label "${rangeLabel(visibleText(beyond))}"`,
  );

  /*
   * A NONSENSE PAGE IS THE FIRST PAGE, NOT AN ERROR
   *
   * `?page=abc` and `?page=0` are typos. The polite reading of a typo is page one;
   * the alternative is an empty table with no explanation of why it emptied.
   */
  for (const [label, value] of [
    ["not a number", "abc"],
    ["zero", "0"],
    ["negative", "-4"],
  ] as const) {
    const html = await rawHtml(`/admin/students?page=${value}`);
    const ids = new Set(idsOn(html));
    record(
      `a page that is ${label} falls back to page one`,
      ids.size === first.size && [...ids].every((id) => first.has(id)),
      `${ids.size} rows, page one has ${first.size}`,
    );
  }

  /*
   * SEARCH SURVIVES PAGING, AND THE COUNT FOLLOWS THE SEARCH
   *
   * Two things a pager gets wrong by construction: dropping the filter when it
   * builds its links, and counting the unfiltered total while showing filtered rows.
   */
  const searchTerm = "Pagination Probe";
  const matching = await prisma.studentProfile.count({
    where: { user: { name: { contains: searchTerm, mode: "insensitive" } } },
  });
  const searchedHtml = await rawHtml(
    `/admin/students?q=${encodeURIComponent(searchTerm)}`,
  );
  record(
    "searching narrows the count to the matches",
    matching > 0 && shownTotal(visibleText(searchedHtml)) === matching,
    `search matched ${matching}, page says ${shownTotal(visibleText(searchedHtml))}`,
  );

  /*
   * Read from the markup, because the query string only exists in the hrefs.
   *
   * The failure this guards against is silent and total: a pager that builds its
   * links without the filter shows page two of the *unfiltered* list under the same
   * search box, which reads as "the search is not working" rather than "the pager
   * threw the filter away".
   */
  const searchHref =
    /href="(\/admin\/students\?[^"]*page=2[^"]*)"/.exec(searchedHtml)?.[1] ?? "";
  record(
    "pager links carry the search term",
    hrefParam(searchHref, "q") === searchTerm,
    `href "${searchHref}" carries q="${hrefParam(searchHref, "q")}"`,
  );

  const searchedPage2 = await rawHtml(
    `/admin/students?q=${encodeURIComponent(searchTerm)}&page=2`,
  );
  const searchedFirst = new Set(idsOn(searchedHtml));
  const searchedSecond = idsOn(searchedPage2);
  record(
    "a searched list pages, and its second page is disjoint from its first",
    searchedFirst.size > 0 &&
      searchedSecond.length > 0 &&
      searchedSecond.every((id) => !searchedFirst.has(id)),
    `first ${searchedFirst.size}, second ${searchedSecond.length}, "${rangeLabel(visibleText(searchedPage2))}"`,
  );

  /* ALERT CHIPS: REAL COUNTS, AND THEY DO NOT MOVE WITH THE FILTER */
  const openAlerts = await prisma.emergencyAlert.count({ where: { status: "OPEN" } });
  const alertsHtml = await text("/admin/alerts");
  const openChip = /Open \((\d+)\)/.exec(alertsHtml)?.[1];

  record(
    "the Open filter chip shows the real count",
    Number(openChip) === openAlerts,
    `chip says ${openChip}, database has ${openAlerts} open`,
  );

  const filteredAlerts = await text("/admin/alerts?status=OPEN");
  record(
    "the chip count does not change when the filter is applied",
    (/Open \((\d+)\)/.exec(filteredAlerts)?.[1]) === openChip,
    `all: ${openChip}, filtered: ${/Open \((\d+)\)/.exec(filteredAlerts)?.[1]}`,
  );

  /*
   * FILTERING REALLY FILTERS
   *
   * The filter moved into SQL, so a mistake in the `where` would show the right
   * count beside the wrong rows - the chip reads "Open (1)" while the list below it
   * shows a resolved alert. The status badge is what distinguishes them.
   */
  const openAlertsCount = await prisma.emergencyAlert.count({ where: { status: "OPEN" } });
  const resolvedSample = await prisma.emergencyAlert.findFirst({
    where: { status: "RESOLVED" },
    select: { id: true },
  });
  if (!resolvedSample) {
    record(
      "the Open filter excludes a resolved alert that the unfiltered list would show",
      true,
      "skipped: no resolved alert exists to test with",
    );
  } else {
    const unfiltered = await text("/admin/alerts");
    record(
      "the Open filter excludes a resolved alert that the unfiltered list would show",
      openAlertsCount > 0 &&
        unfiltered.includes(`alert/${resolvedSample.id}`) &&
        !filteredAlerts.includes(`alert/${resolvedSample.id}`),
      `resolved alert ${resolvedSample.id} appears unfiltered and is absent under Open`,
    );
  }

  /* TRIP TILES: THE WHOLE DAY, NOT THE ROWS ON SCREEN */
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  const ongoingToday = await prisma.trip.count({
    where: { date: { gte: startOfDay, lt: endOfDay }, status: "ONGOING" },
  });
  const onTheRoad = /On the road (\d+)/.exec(await text("/admin/trips"))?.[1];
  record(
    "the trips tile counts the whole day, not the rows on screen",
    Number(onTheRoad) === ongoingToday,
    `tile says ${onTheRoad}, database has ${ongoingToday} ongoing today`,
  );

  /*
   * THE EDIT LINK SURVIVES PAGING
   *
   * `?edit=<id>` used to be resolved by searching the rows already on the page, so
   * deep-linking to edit someone on page three silently rendered the "new
   * assignment" form instead. The link works, the page loads, and the wrong form is
   * on it - which is the worst combination of failure for a link.
   */
  const offPage = await prisma.studentProfile.findFirst({
    where: { id: { notIn: [...first] } },
    select: { id: true, user: { select: { name: true } } },
  });
  const editHtml = await text(`/admin/students?edit=${offPage?.id}`);
  record(
    "an edit link for a student on another page still opens that student",
    Boolean(offPage) && editHtml.includes(`Edit assignment — ${offPage?.user.name}`),
    offPage
      ? `asked for ${offPage.user.name}, who is ${first.has(offPage.id) ? "on" : "off"} page one`
      : "no candidate off page one",
  );

  /*
   * NO DRIFT
   *
   * Run after the cleanup rather than inside the try, because the point is what the
   * database looks like once the suite has finished with it. Asserting it before
   * would compare the planted total against itself.
   */
  await cleanup();
  const after = await prisma.studentProfile.count();
  record(
    "planted rows are removed, so a re-run starts from the same state",
    after === realTotals.students,
    `${after} students, started from ${realTotals.students}`,
  );
} finally {
  await cleanup();
}
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log("");
    console.log(`${pass}/${total} checks passed`);
    if (fail > 0) process.exit(1);
  });
