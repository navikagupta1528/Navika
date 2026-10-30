# BusGuard

Student-aware smart college and school bus management and tracking.

**Know where the bus is. Know your child is on it.**

Most bus tracking products show a dot on a map. BusGuard tracks **people**: which
student is assigned to which bus, which stop they board at, whether they have
stepped out of the house yet, and whether they actually got picked up. That is
what makes it useful to a parent at 7:40 in the morning.

## What is built

Everything below is implemented, wired up and verified. The six phases were
built in order, then four further areas landed on top of them after the
roadmap was first met; those are listed under **Beyond the roadmap** rather than
folded into the phase they relate to.

Current state: **typecheck and lint clean, 526 unit tests, 297 HTTP smoke
checks across twelve suites, Lighthouse 98 / 100 / 100 / 100 on all three public
pages, 38 routes building.**

**Phase 0 - foundation**

- Next.js 16 App Router, TypeScript, Tailwind v4
- PostgreSQL 17 via Prisma 7, 19 models and 9 enums with real foreign keys
- Session auth: httpOnly cookie, `jose` JWT, four roles
- Sign-in and registration throttling, with the per-account and per-address
  budgets deliberately on different schedules — see
  [Sign-in throttling](#sign-in-throttling) for why making them equal would
  lock out a whole school
- Auth errors announced to assistive technology, with each message tied to its
  field by `aria-describedby`
- Role-gated dashboards for student, parent, driver and admin
- Socket.IO attached to a custom Node server, with cookie-based handshake
- Demo seed: 3 routes, 12 stops, 5 buses, 6 drivers, 40 students, 8 parents,
  two live trips

**Phase 1 - CRUD, trips and attendance**

- Admin CRUD for stops, routes, buses, drivers, students and enrolments
- Soft delete with a `deletable` guard that mirrors the referential check, so
  the UI cannot offer an action the server will refuse
- Trip lifecycle: schedule, start, close, plus per-trip detail
- Attendance roster per trip with driver check-off
- Attendance reporting across trips

**Phase 2 - maps and ETA**

- MapLibre GL with an inline OSM raster style, no API key and no lock-in
- Route polyline, numbered stop markers, drag-to-reorder stop editing
- OSRM for road-accurate ETA and distance, with a haversine fallback that
  degrades quietly when the routing server is unavailable
- `EtaCache` table so a slow routing server is never on the request path twice

**Phase 3 - live tracking**

- Driver PWA publishing GPS from the browser's `watchPosition`
- Live map per bus, plus a fleet map for everything you are entitled to watch
- "I am waiting" from the student, visible to the driver in real time
- Authorization: a parent can only open the bus their child is actually on
- GPS acceptance rules that reject stale, future, blurry and teleported fixes

**Phase 4 - notifications and push**

- In-app notification inbox for all four roles
- Guardians notified on pick-up, with the stop name, the clock time and a link
- Web push via VAPID, degrading to a no-op when no keys are configured
- Emergency alert button, available to all four roles, with a 700 ms hold

**Phase 5 - deployment**

- `render.yaml` blueprint including a managed Postgres, pinned to a start
  command that runs `server.ts` rather than `next start`
- `/api/health` for the load balancer, which distinguishes an unreachable
  database from an un-migrated one
- No container image: Render's native Node builder runs the same command
  sequence as a laptop, which is what made this deployable at all

**Beyond the roadmap** — thirteen areas built after the six phases were met:

- **Arrival intelligence.** The ETA a parent actually watches was the one number
  on the tracking screen that never moved: it was computed once on the server and
  passed as a prop, so the socket driving the map left it frozen. It now counts
  down live, and two geofence rings around each stop send a "bus is almost at
  your stop" push at ~800 m and an "at your stop" one at ~150 m. The ring
  decision is pure and tested (`src/lib/geofence.ts`), the countdown arithmetic
  is pure and tested (`src/lib/arrival.ts`), and a `StopApproach` row makes each
  alert fire exactly once per stop, direction and day — durably, so a restart
  mid-run does not re-notify. See [Arrival intelligence](#arrival-intelligence).

- **Motion and measured performance.** CSS-only entrances, hover lift, press
  feedback, an active-nav rail, sweeping skeletons and an ambient background on
  the sign-in screens, plus a Lighthouse run wired into `npm run lighthouse`
  that fails the build on a regression. The rules the motion follows and the
  defects measuring it uncovered — including the icon change that took the
  landing page from 86 to 98 — are in **Design decisions** below.

- **A public landing page, and a visual pass over every signed-in screen.** `/`
  is a real marketing page now (hero, product preview, features, roles, call to
  action) instead of a redirect pole, so a stranger can see what the product is
  before making an account — while the proxy still sends a signed-in visitor
  straight to their own dashboard. Underneath it, one set of shared primitives
  was restyled and an icon layer replaced the emoji glyphs, so a change to a
  `Card` or a `PageHeader` reaches every page at once instead of forty copies.
- **CSV exports.** Attendance across a date range, per-student history, and a
  trip manifest. The escaping and the formula-injection guard live in a pure
  module (`src/lib/csv.ts`, 37 tests) because a spreadsheet that silently
  evaluates `=cmd(...)` from a student's name is a real problem, not a
  theoretical one. Ranges are always explicit and capped at 400 days; an invalid
  range is a 400, never a silent "everything".
- **Route simulation.** `src/lib/simulator.ts` drives a bus along its own route
  from a server-side timer, so the live map can be demonstrated without a phone
  in a car. Pure route maths (40 tests), server-side interval, admin toggle.
- **Abandoned-trip reconciliation.** A trip left `ONGOING` by a crashed deploy
  or a dead phone kept its bus looking live and blocked the driver from starting
  the next run. Liveness is decided by recent activity rather than the status
  column, in a pure tested module (`src/lib/trip-liveness.ts`, 19 tests).
- **Route-boundary enforcement.** `/track`, `/fleet`, `/notifications` and
  `/install` were protected only by each page's own `requireRole`, which throws
  after React has begun streaming — so an anonymous visitor received a 200
  carrying the app shell with the redirect arriving later as a meta-refresh tag.
  The proxy now answers before anything renders, making it a real 307.
- **"The bus left without your child."** The alert that matters most to a family
  is the one the geofence cannot produce: the bus came, and then it went, and the
  child who pressed "I'm waiting" is still standing there. A departure is a
  third ring in `StopApproach` (`DEPARTED`), claimed before the roster is
  written, and it resolves the stop's pickup records the way the enum always
  said it should — `WAITING` becomes `MISSED` (a safety incident, pushed to the
  guardian with the driver's phone number and a one-tap "My child is safe"
  resolve) and `PENDING` becomes `ABSENT` (bookkeeping, pushed to nobody). A
  child already ticked on is never demoted. The decision is pure
  (`src/lib/boarding.ts`, 14 tests); `npm run smoke:boarding` proves the wiring
  against a real database. Real trips only — a simulated bus has no roster, so
  there is nobody to be left behind.
- **Live delay intelligence.** A stop scheduled for 07:30 that the bus reaches at
  7:38 is eight minutes late, and the family waiting there is told so — in the
  arrival message itself ("It is running 8 min late.") and as a separate push
  once the delay clears five minutes. The threshold is the point: below it the
  number is noise that trains people to ignore the alert. The arithmetic is pure
  (`src/lib/delay.ts`, 13 tests); `npm run smoke:delay` proves the ring is
  claimed before the notification and that a second arrival sends nothing.
- **Driver safety scorecard.** The GPS stream was being used to draw a dot; it
  is now also scored. Two consecutive fixes reveal what one cannot — a harsh
  brake, a hard acceleration, an overspeed — and a week of those events collapses
  into a single rankable number per driver, worst first, on `/admin/safety`.
  The events are persisted, because a manager told "this driver scored 45" will
  ask "what did they do?" and the answer has to be a list of moments. The
  detection and scoring are pure (`src/lib/driving.ts`, 16 tests); the previous
  fix is held in memory and the events in the database, so a missed
  classification after a restart costs one event while a lost event would cost
  the audit trail.
- **Reporting a bus without a phone.** A driver's browser is not the only way a
  bus can report, and for a real fleet it is often not the way at all. A tracker
  fitted to the vehicle authenticates with a per-bus bearer token — shown once,
  stored only as a hash — and posts to `POST /api/ingest/location`. The endpoint
  shares `applyPosition` with the driver's Socket.IO ping, so the two paths cannot
  disagree about what a position means. The token model, admission control and
  freshness rule are pure and tested (`src/lib/device-token.ts`,
  `src/lib/device-ingest.ts`); the mint/revoke UI sits on the bus screen.
  See [Reporting a bus without a phone](#reporting-a-bus-without-a-phone).
- **Multi-instance broadcasting.** One process broadcasts to its own clients for
  free; two are two fleets, and the failure is invisible — every page renders and
  half of them watch a frozen map. `REDIS_URL` now swaps Socket.IO onto a shared
  adapter, opt-in so the single-instance deployment ships exactly as before. The
  decision is pure and tested (`src/lib/realtime-scaling.ts`), and `/api/health`
  reports the mode under `realtime`.
- **Production hardening.** Two quiet failure modes closed. A production build
  still pointed at OpenStreetMap's public tile server — which the OSM policy does
  not cover, and whose failure is a grey map rather than an error — now warns in
  the browser console on every map load (`src/lib/map-tiles.ts`). And a ping
  replayed out of a phone's socket buffer was re-stamped with the server's clock,
  drawing the bus jumping backwards; the client now sends its own fix timestamp
  and the server refuses anything older than the window it already uses
  (`classifyReportAge`).

## Sign-in throttling

Sign-in originally had no attempt limit. bcrypt at cost 12 makes an offline guess
expensive and, incidentally, makes an online guess expensive for the defender —
but *expensive per attempt* is not *bounded in total*. A script got one comparison
per guess and could keep guessing forever against the system whose whole purpose
is reporting where children are.

**The trap.** Throttle on the submitted email and an attacker with no password
needs nothing else: post wrong passwords for a known address a few times, and that
student cannot sign in for the length of the window. The limiter becomes the
weapon — no credentials, no access, no trace. Four things prevent it here. The
window caps at fifteen minutes, because this app has no self-service unlock, so
the window length *is* the worst case for someone targeted. A success clears the
budget. The counter is keyed on the submitted address before the account is
looked up, so "locked out" versus "incorrect password" reveals nothing about which
addresses are registered — which is the student and guardian roster. And the two
schedules are asymmetric.

**Why the schedules differ.** Per account is strict: three free attempts, then an
escalating table up to fifteen minutes. That is what bounds an attacker's exposure
of any one password. Per address is lenient: twenty-five free attempts.

That number is set by who is behind the address, not by the attacker. A college
runs every sign-in through one NAT address, and at two thousand students a
fifteen-minute window on a weekday morning comfortably exceeds a dozen mistyped
passwords behind it. A strict per-IP limit defends nothing there — it is the
denial of service above, aimed at the whole school at 8:40am, triggerable by
anyone who can type three wrong passwords. Twenty-five is above the plausible
human floor and still low enough that a script cannot reach a meaningful number
of accounts in one window; and because the per-account limit stays strict
regardless, raising the address ceiling buys a *spray*, not a breach.

Registration is throttled on its own budgets, for the same NAT reason one flow
over: an office creating accounts all morning must not lock out the students
behind the same address. It is also what bounds account enumeration, since the
form has to say whether an address is taken and enrollment numbers are sequential.

Counters live in the Node process. For this single-instance deployment a redeploy
clearing them is the behaviour you want — nobody should be locked out because a
deploy landed at the wrong minute — and a restart is a brief amnesty. That trade
would not hold on a multi-instance deployment, where this would need the same
shared store as everything else.

Two defects surfaced while writing the tests, both of which looked correct:

- An off-by-one in both tables. The schedule is indexed by the failure count
  *including* the one just recorded, so a leading run of 25 zeros grants 24 free
  attempts, not 25 — while reading as twenty-five. It was wrong the same way
  twice before a test compared the table against the number it advertises.
- `!Number.isFinite(failures) → 0`, which reads as caution and quietly maps a
  positive infinity to *no penalty* — handing over the exact unbounded run the
  function exists to prevent. `NaN` now answers 0 and infinity clamps.

34 unit tests cover the schedule; 10 smoke checks cover the wiring, by posting the
real sign-in form.

## Paging, and the numbers that were quietly wrong

Three lists took a fixed number of rows and said nothing about the total: students
25, trips 100, alerts 100. Past those numbers the extra rows did not fail to load —
they were never asked for, and nothing on screen said so. An admin looking at a
week of trips across a real fleet would have seen a complete, confident, quietly
wrong list.

A hard cap without a count is not a limit. It is a claim about the size of the data.

For the alerts list that was not a cosmetic problem. The rows that vanish are
emergency alerts, so the truncation silently removed the entries that matter most.

**The worse half.** Each of those pages also computed its tiles from the rows it
had fetched:

- `Open (3)` was the number of open alerts *among the hundred most recent*.
- `On the road 0` was the number of ongoing trips *among the hundred fetched* — so
  a fleet running more than a hundred trips in a day showed zero while buses were
  moving.

A number that is quietly the wrong number is worse than one that is visibly a
sample, because it is presented with the same confidence either way. Those counts
are now `groupBy` queries against the whole table.

**Clamping, and why it is not part of parsing.** `?page=5` on a list that has since
shrunk to two pages has to show page two, and the last page is not known until the
count has run. The obvious implementation parses `?page=`, queries `skip`/`take`
from it, then clamps for display — which produces "Showing 26 to 40 of 40" above
an empty table. The label and the rows are each individually correct and jointly a
lie. So `src/lib/paged-query.ts` counts first, clamps, and only then builds the
query, which costs a round trip and is not avoidable.

**Ordering, which is not arithmetic.** Two buses on the same route at the same
time on the same date tie on both `{date, scheduledStart}`, and Postgres is free to
return tied rows in a different order between the request that fetches page one and
the request that fetches page two. The list then neither loses nor duplicates
anything — a trip simply appears on both pages, or on neither. Invisible with
twenty-five rows, present the moment there are more. Every paged `orderBy` now ends
in the primary key.

**Search moved into SQL.** The students page fetched every student with every
enrolment and every guardian attached, then filtered in JavaScript — a page that
loaded the whole school to draw twenty-five rows. One behaviour change worth naming:
a term used to match those fields concatenated with spaces, so it could match
*across* them. Nobody types that on purpose, and it made results depend on field
order.

**A bug that only paging could introduce.** `?edit=<id>` was resolved by searching
the rows already on the page. Once the list is paged, deep-linking to edit someone
on page four silently renders the "new assignment" form instead: the link works,
the page loads, and the wrong form is on it. That lookup is now by id.

`smoke:pagination` plants thirty students to push the list past a page boundary,
checks that page two is *disjoint* from page one by comparing row ids rather than
looking for a difference, and removes what it planted. Its first three checks
compare what each page prints against a direct count from the database, which is
the only way to catch a truncation bug — the truncation was invisible precisely
because the page was self-consistent.

## Arrival intelligence

The question this feature answers is the one the whole product exists for: *is
my child's bus nearly here, and has the bus reached us yet?*

**The ETA was the only frozen number on a live page.** The tracking screen
streams the bus's position over Socket.IO and moves the dot on the map, but the
"arriving in N minutes" figure beside it was computed once on the server and
passed as a prop. A parent who opened the page with the bus five minutes out saw
`5 min` for those five minutes. That is worse than showing nothing, because it
looks live.

The countdown now recomputes from each position the socket delivers, and — this
is the part that makes it feel alive — it *decays* the estimate by the age of the
fix. A bus that pinged eight seconds ago is eight seconds closer than the figure
computed from that ping alone implies, so the number ticks down between pings
instead of jumping when the next one lands. The arithmetic is pure
(`src/lib/arrival.ts`) and shared with the map popup, so the card and the popup
cannot disagree.

**Two rings, not one alert.** A single "the bus is here" notification is too late
to be useful — by the time it arrives the child has to run. Each stop has two
thresholds:

| Ring | Distance | What it tells a family |
| ---- | -------- | ---------------------- |
| `APPROACHING` | ~800 m | the bus is on its way; get ready |
| `ARRIVING` | ~150 m | the bus is at the kerb; go now |

When a position lands inside both — a bus that jumped, or the first fix after a
tunnel — only the tighter ring fires, because "in 3 minutes" and "arriving now"
in the same breath is worse than the accurate one. In the ordinary case the bus
crosses the outer ring minutes before the inner, so both arrive, well spaced.

**Once per stop, per run — and it survives a restart.** A bus spends minutes
inside the 800 m ring, reporting every few seconds. An in-memory "already sent"
set would notify four times a minute for two minutes, and would re-notify every
stop the bus had already served the moment the server restarted. So the claim is
a row: `StopApproach`, unique on `(bus, stop, direction, ring, date)`, written
*before* the notifications go out. Two ticks racing through the watcher cannot
both win the unique constraint; a deploy mid-run cannot replay an alert. The row
is a date, so tomorrow's bus notifies again, and a boot sweep trims rows older
than a fortnight.

**The alert goes to the people at that stop, not to a role.** Recipients are
resolved through `Enrollment`: the guardians — and the student — of the children
enrolled to board that bus at that stop, in that direction. Notifying "all
parents" would leak one child's bus position to families whose children are not
on it, which is the same mistake the pick-up notification was built to avoid.

`npm run smoke:geofence` proves the parts a unit test cannot: that the dedup row
is written before the notification, that a second tick sends nothing, that the
message names the stop and deep-links to the map, and that it reaches a real
guardian row in the database.

## Reporting a bus without a phone

Everything above assumes the driver has a browser open. The ordinary installation
for a school is the opposite: a tracker is fitted to the vehicle and reports
whether or not anyone's phone is awake. That path exists now, and it is deliberately
narrow.

**One endpoint, one token per bus.** An admin opens a bus and generates a tracker
token; the plaintext is shown once and only ever the hash is stored. The device
then posts to it:

```bash
curl -X POST "$APP_URL/api/ingest/location" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"lat":18.5204,"lng":73.8567,"speedKph":31,"headingDeg":148,"recordedAt":"2026-10-17T07:12:03Z"}'
```

`speedKph`, `headingDeg` and `accuracyM` are optional; `recordedAt` is the
device's own clock and is what makes the freshness check possible. A token is
revoked rather than deleted, so the panel can still show what the device was and
when it stopped being trusted.

**The same pipeline as a driver's phone.** The endpoint does not have its own
idea of what a position means. It shares `applyPosition` with the Socket.IO ping,
so a tracker and a phone cannot drift apart on validation, the onboard count, the
broadcast, the persist cadence or the three watchers that hang off the same
stream (approach, departure, driving).

**A replayed fix is refused, not re-stamped.** Socket.IO buffers a phone's events
while it is out of signal and flushes them on reconnect, and each buffered event
carries the timestamp of when the fix was *taken*. The server previously stamped
arrival time onto everything, so a five-minute-old fix would arrive looking fresh
and draw the bus jumping backwards to where it was five minutes ago — the exact
teleport the client rules exist to prevent, hidden by a fresh timestamp. The
device now sends `recordedAt` and the server rejects a report older than the same
sixty-second window the client uses (`classifyReportAge`), answering `409` instead
of pretending. An untimestamped report is still accepted: it is either an older
client or the server's own simulator, and neither is replaying anything.

`npm run smoke:ingest` proves the boundary, not the library: that a report with
no token is refused, that a revoked token stops working the instant it is revoked,
that a ping inside the minimum interval is dropped with a `Retry-After`, that a
replayed fix is rejected with `409`, that two trackers on one bus do not throttle
each other, and that an accepted ping writes the bus row exactly as a driver's
phone does.

## Stack

| Concern            | Choice                             | Why                                                              |
| ------------------ | ---------------------------------- | ---------------------------------------------------------------- |
| Framework          | Next.js 16 (App Router, Turbopack) | Server Components for data-heavy dashboards, one deploy target    |
| Database           | PostgreSQL 17 + Prisma 7           | Real foreign keys and transactions, no MongoDB workarounds        |
| Auth               | `jose` JWT in an httpOnly cookie   | No token in `localStorage` for XSS to steal                       |
| Realtime           | Socket.IO on a custom Node server  | WebSocket fan-out for live positions                              |
| Maps               | MapLibre GL + OpenStreetMap        | No API key, no billing, no Google lock-in                        |
| ETA                | OSRM public API, haversine backup  | Road-accurate when available, never a hard dependency            |
| Validation         | Zod v4                             | One schema shared by form and Server Action                       |
| Tests              | Vitest + HTTP smoke scripts        | Pure logic unit tested; authorization tested end to end           |

**Deploy on a Node host** (Render, Railway, Fly, a VPS). Not Vercel:
Socket.IO needs a persistent connection and does not work on Vercel's
serverless runtime. There is no container image to build — the app is a plain
Node process, and the deploy is `npm ci && npm run build` followed by
`npm run start`.

## Getting started

### 1. Install

```bash
npm install
```

### 2. Create the database

BusGuard uses its **own** PostgreSQL cluster at `C:\navika-pg` on **port 5433**, so
it never touches the PostgreSQL 17 service on 5432 that belongs to ZyniVerse.

```bash
npm run setup:db
```

That script initialises the cluster, creates the `busguard` role and `busguard`
database with a generated password, switches its `pg_hba.conf` to
`scram-sha-256`, and writes `.env` for you.

If you would rather do it by hand against an existing server:

```sql
CREATE ROLE busguard LOGIN PASSWORD 'pick-something';
CREATE DATABASE busguard OWNER busguard;
ALTER ROLE busguard CREATEDB;   -- Prisma needs this to create the shadow database
```

Then copy `.env.example` to `.env` and fill in `DATABASE_URL` and `AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Migrate and seed

```bash
npm run db:migrate
npm run db:seed
```

> Prisma 7 does not regenerate the client as part of `migrate dev`. After a
> schema change, run `npm run db:generate` as well or the types will not move.

### 4. Run

```bash
npm run dev
```

Open <http://localhost:3000>.

`npm run dev` starts the database first and the app second, so one command is
all it takes — including the first run after a reboot. `db:start` exits
immediately when the cluster is already listening, so the extra step costs
nothing on a machine where it is already up. Only the production `npm start`
skips it, because on a deployed host the database is managed separately.

> The cluster at `C:\navika-pg` is a plain process, not a Windows service, so it
> does not come up on its own. To make it start with Windows and skip this
> entirely, register it once as Administrator:
>
> ```powershell
> & "$env:ProgramFiles\PostgreSQL\17\bin\pg_ctl.exe" register -N "NavikaPG" -D "C:\navika-pg" -S auto
> ```

### Port

`npm run dev` reads `PORT`, falling back to 3000. ZyniVerse already uses 3000,
so BusGuard's `.env` sets `PORT=3010`. It belongs in `.env` rather than only in
the shell that happened to start the server, or the next `npm run dev` silently
collides.

### Demo accounts

Password for all of them: `busguard123`

| Role    | Email                               |
| ------- | ----------------------------------- |
| Admin   | `admin@busguard.test`                 |
| Driver  | `driver1@busguard.test`               |
| Driver  | `driver2@busguard.test`               |
| Parent  | `parent1@busguard.test`               |
| Student | `aarav.sharma0@student.busguard.test` |

The seed stamps bus positions with `lastLocationAt` at seed time, so they fall
outside the two-minute live window a couple of minutes after seeding. Open
`/fleet` right after seeding, or restamp:

```bash
npm run db:seed && npm run smoke:tracking
```

## Scripts

| Command                 | What it does                                             |
| ----------------------- | -------------------------------------------------------- |
| `npm run dev`           | Custom server: starts the database, then Next.js dev + Socket.IO |
| `npm run build`         | Production build                                         |
| `npm start`             | Custom server in production mode (run `build` first)     |
| `npm run typecheck`     | `tsc --noEmit`                                           |
| `npm run lint`          | ESLint                                                   |
| `npm run test`          | Vitest, pure logic only                                  |
| `npm run verify`        | typecheck + lint + test + build                          |
| `npm run smoke`         | Realtime handshake against a running server              |
| `npm run smoke:auth`    | Log in as every role, check the dashboards render        |
| `npm run smoke:admin`   | Admin CRUD and trip lifecycle against a running server   |
| `npm run smoke:tracking`| Tracking, attendance, alerts, notifications              |
| `npm run smoke:reconcile` | Plant real rows, prove abandoned trips close and live ones don't |
| `npm run smoke:boundaries` | Every portal page, every role, anonymous and wrong-role  |
| `npm run smoke:pagination` | Real counts, disjoint pages, clamping, filters surviving paging |
| `npm run smoke:instrument` | Prove `npm run audit`'s layout-shift observer actually fires |
| `npm run smoke:geofence` | The stop-approach alert: fires once, reaches the right guardians, dedupes on repeat |
| `npm run smoke:boarding` | The bus-left-without-your-child alert: MISSED vs ABSENT, the right guardian told, idempotent |
| `npm run smoke:delay`    | The late-bus alert: claimed before it sends, carried in the arrival message, deduped |
| `npm run smoke:ingest`   | A fitted tracker: bearer auth, a revoked token refused, a replayed fix rejected, the bus row written |
| `npm run smoke:all`     | All twelve smoke suites                                   |
| `npm run audit`         | Every route, every role, in a real browser: console, network, hydration, WCAG, layout shift |
| `npm run map:tour`      | Walk every route through the map renderer, offscreen     |
| `npm run check:osrm`    | Is the configured OSRM server reachable and sane?        |
| `npm run setup:db`      | One-time database provisioning                           |
| `npm run db:start`      | Start the local database cluster (run automatically by `npm run dev`) |
| `npm run db:migrate`    | Create and apply a migration in development              |
| `npm run db:deploy`     | Apply pending migrations (production, CI)                |
| `npm run db:seed`       | Reset to a believable demo dataset                       |
| `npm run db:studio`     | Prisma Studio                                            |
| `npm run db:reset`      | Drop, re-migrate and re-seed                             |
| `npm run setup`         | All three setup steps in order                           |
| `npm run lighthouse`    | Score all three public pages, fail on a regression              |

The smoke suites need a running dev server and a live database. Start both, then
run them.

```
npm run db:start      # only if the machine has just rebooted; npm run dev does this for you
npm run db:seed       # resets to a demo dataset, and restores live trips
npm start &           # or npm run dev, which starts the database itself
npm run smoke:all
```

`smoke:admin` and `smoke:tracking` write to and clean up after themselves, but
both expect the seed: `smoke:tracking` in particular needs two `ONGOING` trips
and will say so plainly rather than failing obscurely if the database is bare.

They are not idempotent against the *seed*, though. `smoke:delay` deletes today's
trip for the bus it exercises, `smoke:boarding` and `smoke:geofence` roll back
their own fixtures, and `smoke:pagination` plants thirty students it later
removes — so a second `smoke:all` without a re-seed starts from a database with
no live trip at all, and the suites that read the seed's trips report an empty
page as a defect. Re-run `npm run db:seed` before each full pass; the block above
is the sequence to repeat, not a one-time setup.

## The page audit

`npm run audit` is the only check here that opens a page in a real browser. Every
other suite asks a server a question over HTTP and reads the answer; none of them
can see a hydration mismatch, a Client Component that throws on mount, a chunk
that 404s, a link that is only distinguishable by colour, or a page that jumps
after it loads.

It drives Chrome over every route/role combination it can address — 45 of them on
a quiet database, 49 when a live trip adds a `/track` visit for each role — and
reports:

| Kind | What it catches |
| --- | --- |
| `console-error`, `console-warning` | Anything logged by the page, including React's hydration mismatch |
| `page-error` | An uncaught exception |
| `request-failed`, `bad-response` | A dropped request, or any response at or above 400 |
| `a11y:*` | axe-core, WCAG 2.0/2.1 A and AA |
| `layout-shift` | Cumulative Layout Shift above the 0.1 "good" line |
| `advisory` | Printed on purpose — reported in its own section, never failed |

Failing on *any* console warning is the right default: in production a warning is
nearly always a React key warning or a hydration mismatch wearing a different hat,
and a gate that cannot fail is not a gate. The exception is the map's tile notice,
which is supposed to print whenever a production build is still pointed at
OpenStreetMap's public server — and `NEXT_PUBLIC_MAP_TILE_URL` is inlined into the
bundle at build time, so it cannot be supplied at audit time to make it go away.
Failing on it would leave the audit red on a clean checkout with nothing actually
wrong, and six copies of it would bury the next real warning. So it is listed by
name in `DELIBERATE_WARNINGS`, matched on a distinctive phrase rather than a
prefix, and reported separately; every other warning still fails.

It needs the dev server running (for `/`, `/login` and `/register`) and a seeded
database (for the `[id]` routes).

Two things about it are load-bearing and easy to undo by accident:

**It waits for `domcontentloaded` and then a fixed settle, not for network idle.**
A page with a live map never goes idle — the basemap keeps pulling tiles and the
socket stays open — so `networkidle2` timed out at 30s on two routes and reported
`threw: Navigation timeout` as though the page were broken.

**Its layout-shift observer is verified by `smoke:instrument`, which runs first in
`smoke:all`.** That suite inserts a tall block into a real page and fails unless
the audit's own instrumentation measures the shift (it lands at 0.292). This is
not ceremony. The observer silently failed to attach for several iterations —
esbuild's `keepNames` rewrites an inner arrow bound to a `const` into a
`__name(fn, "name")` call, and `__name` does not exist in the browser — and the
audit's response was to report a clean `0.000` on every route. A check that
cannot fail is worse than no check, because it looks like evidence. The audit now
also refuses to read a number unless the observer confirms it attached.

## Deploying

There is no container image. BusGuard is a plain long-lived Node process, and the
deploy is two commands:

```bash
npm ci
npm run build
npm run start          # this is `tsx server.ts --prod`
```

`npm run start` is the whole deployment story, and the "start" is not
`next start`. Next's own start command serves pages but no socket, so live
tracking would fail *quietly* — every dashboard would render, and no bus would
ever move. `server.ts` is one process serving both, which is the only reason
Socket.IO works here at all.

Run migrations as a **release step, before the new build takes traffic**:

```bash
npx prisma migrate deploy
```

Not as a startup command, and this is not a style preference. Two instances
starting together race each other through the migration list, and a half-applied
migration is worse than a failed deploy: the deploy stops and the old build keeps
serving. `render.yaml` expresses this as `preDeployCommand`.

### Render

`render.yaml` is a blueprint. Push the repo to GitHub, then in Render choose
**New > Blueprint** and point at it. Render creates the Postgres cluster and the
web service, wires `DATABASE_URL` between them, and asks you for the secrets
marked `sync: false`.

Set these in the dashboard before the first deploy:

| Variable                    | Why                                                  |
| --------------------------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`       | Your `https` origin, no trailing slash                |
| `NEXT_PUBLIC_MAP_TILE_URL`  | OSM's public tiles are explicitly dev-only            |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | The browser half of the push key pair              |
| `VAPID_PRIVATE_KEY`         | Server half. Never expose this                        |
| `VAPID_SUBJECT`             | `mailto:` address; browsers reject a push without it  |

`AUTH_SECRET` is generated for you.

> **The `NEXT_PUBLIC_*` trap.** Those values are inlined into the JavaScript
> bundle at **build** time, not read per request. Changing one on a running
> server does nothing until you rebuild and redeploy, and no error message will
> tell you so. This is the most common reason a deployed map comes up blank or
> push silently stops working.

### Scaling past one instance

Implemented, and opt-in. Socket.IO broadcasts from whichever process holds a
driver's connection, so two instances are two fleets: a parent on instance B
sees a frozen map while every page renders normally, and nothing logs an error.
`REDIS_URL` swaps the server onto a shared Redis adapter so a broadcast on one
instance reaches a watcher on the other. Unset, it is the single-instance
configuration this project ships, and behaves exactly as before.

`/api/health` reports which mode an instance is in, under `realtime` —
`redis` or `single-instance` — so a load-balanced deployment that forgot to set
`REDIS_URL` is visible from the health check rather than as a mystery on the
screen. `render.yaml` documents the two steps: create a Redis service, then set
`REDIS_URL` from it before raising `numInstances`.

## Project layout

```
prisma/
  schema.prisma          21 models, 10 enums, real FK constraints
  seed.ts                demo dataset
scripts/
  setup-db.ps1           one-time database provisioning
  start-db.ps1           start the local cluster; `npm run dev` calls it first
  smoke-*.ts             twelve HTTP suites against a running server
  smoke-reconcile.ts     abandoned-trip reconciliation, on real rows
  smoke-boundaries.ts    route and role boundaries, end to end
  map-tour.ts            offscreen render of every route
  check-osrm.ts          is the routing server reachable and sane?
  lighthouse.mjs         score all three public pages, fail on a regression
  find-broken-line.mjs   locate the first line that breaks parsing
  lib/http.ts            shared smoke helpers
server.ts                custom Node server: Next.js + Socket.IO
render.yaml              Render blueprint, incl. managed Postgres
src/
  app/
    page.tsx             the public landing page, a Server Component
    (auth)/              login, register
    (portal)/
      admin/             CRUD, trips, reports, safety, alerts
      driver/            today's trip, checklist, GPS panel
      student/ parent/   dashboards, fleet, track, notifications, install
      error.tsx loading.tsx not-found.tsx   boundary files
    actions/             Server Actions, thin wrappers over lib cores
    api/health/          load balancer health check
    api/ingest/location/route.ts  a fitted tracker reports a bus position
    api/admin/**/route.ts three guarded CSV export endpoints
  components/
    marketing/           the public landing page, one section per export
    map/                 MapLibre canvas, route editor, vehicle popups
    tracking/            driver tracker, live map, fleet map, arrival countdown, safe button
    ui/                  shared primitives, and the icon registry
    driver/ notifications/ admin/ auth/ portal/
  hooks/
    use-driver-tracker   watchPosition state machine
  lib/
    db.ts                Prisma singleton with the pg driver adapter
    session.ts           cookie read/write (Next.js side)
    dal.ts               authorization: requireSession, requireRole
    api-auth.ts          API-side guard, returns 401/403 not a redirect
    login-throttle.ts    attempt budgets and backoff, pure, no ambient clock
    login-guard.ts       the one live store, and where a request's IP comes from
    pagination.ts        page arithmetic and clamping, pure
    paged-query.ts       count, clamp, then fetch - in that order
    queries.ts           scoped read helpers
    day-window.ts        "today" as one half-open local range, pure
    geo.ts               haversine, bearing, ETA fallback
    arrival.ts           live countdown arithmetic, pure
    boarding.ts           the bus-left-without-your child decision, pure
    delay.ts              scheduled-vs-actual lateness, pure
    driving.ts            harsh-brake / overspeed detection and scoring, pure
    geofence.ts          stop-approach ring decisions, pure
    device-token.ts      tracker token minting, hashing and parsing
    device-ingest.ts     per-device ping and persist admission, pure
    map-tiles.ts         which tile server to use, and when to warn about it, pure
    realtime-scaling.ts  is a Redis adapter configured? pure
    osrm.ts              routing client
    osrm-parse.ts        response parsing, no network
    route-order.ts       stop ordering, no DB
    tracking.ts          GPS acceptance and freshness, pure
    fleet-filter.ts      one definition of "reportable as live"
    tracking-queries.ts  scoped tracking reads
    student-scope.ts     the student/guardian relation path, in one place
    attendance.ts        attendance and alert write cores, request-scope-free
    attendance-summary.ts per-trip aggregation, not per-day, pure
    notifications.ts     notification fan-out
    push.ts              web push with dead-endpoint pruning
    csv.ts               CSV escaping and formula-injection guard, pure
    simulator.ts         route movement maths, pure
    trip-liveness.ts     "is this trip still alive?", pure
    socket-events.ts     the realtime contract, shared by both sides
    realtime.ts          browser socket singleton and the arrivals hook
    health.ts            health-check classification, pure
    validations.ts       Zod schemas
    auth-password.ts     password hashing and verification
    utils.ts             formatting
  server/
    session-core.ts      JWT crypto with no framework dependency
    socket.ts            Socket.IO wiring, rooms, throttling, Redis adapter
    realtime-emit.ts     the server-side emitters, split out to break a cycle
    position-pipeline.ts one place a bus position is accepted, published, recorded
    device-auth.ts       bearer-token lookup for a fitted tracker
    simulator-runner.ts  the interval, the writes, the broadcast
    geofence-watcher.ts  stop-approach alerts: dedup, fan-out, retention
    boarding-watcher.ts   the bus-left-without-your-child alert and roster write
    delay-watcher.ts      late-bus alerts from scheduled-vs-actual
    driving-watcher.ts    GPS stream to safety events, scoring input
    trip-reconciler.ts   closes abandoned trips on boot and every 10 min
  proxy.ts               optimistic route redirects (Next 16 renamed middleware)
  generated/prisma/      generated client (git-ignored)
```

Modules listed without a note are thin: Prisma calls, socket wiring, or
formatting. The ones called out as *pure* import nothing from the database, the
network or the DOM — that constraint is what makes them testable, and it is why
they use relative sibling imports rather than `@/lib/...`, because Vitest has no
path-alias configuration here.

## Testing

Two layers, because they catch different things.

**Unit tests** (`npm run test`, 526 assertions over 26 files) cover the logic
where a bug is invisible from the outside: GPS acceptance, ETA parsing, stop
ordering, freshness decay, CSV escaping, route-movement maths, trip liveness,
arrival countdown, geofence rings, and health classification. These modules
deliberately import nothing from the database, the network or the DOM, which is
what makes them testable at all — and is why they use relative sibling imports
rather than `@/lib/...`, because Vitest has no path-alias configuration here.

**Smoke suites** (`npm run smoke:all`, 297 checks over twelve suites) run against a
real server and a real database, because the bugs that matter most here are
authorization bugs, and those only appear when a real session meets a real row:

| Suite               | Checks | Covers                                                       |
| ------------------- | -----: | ------------------------------------------------------------ |
| `smoke:instrument`  |      4 | The page audit's layout-shift observer really fires           |
| `smoke`             |      3 | Socket handshake: anonymous refused, valid cookie accepted, forged cookie refused |
| `smoke:auth`        |     23 | Every role can log in and its dashboard renders with data; forged cookies refused; sign-in throttling, per account and across a run of failures |
| `smoke:admin`       |     48 | CRUD, referential guards, trip lifecycle, attendance reports  |
| `smoke:tracking`    |     96 | Authorization on `/track`, the driver checklist, attendance writes and their refusals, notification fan-out, alerts, the health endpoint |
| `smoke:reconcile`   |     10 | Abandoned trips close; live ones are left alone                |
| `smoke:boundaries`  |     57 | 27 portal pages requested anonymously, the landing page answering an anonymous visitor, a 4×4 role matrix (including each role bounced off `/`), deep links, forged cookies, the API |
| `smoke:pagination`  |     19 | Counts against the database, page two disjoint from page one, clamping, filters surviving paging |
| `smoke:geofence`    |      7 | The stop-approach alert: the dedup row is written before the notification, a repeat tick sends nothing, the message names the stop and deep-links, and it reaches a real guardian row |
| `smoke:boarding`    |     10 | The bus-left-without-your-child alert: a waiting student becomes MISSED, an unmarked one ABSENT, a child already on the bus is never demoted, the guardian is told, and a second tick changes nothing |
| `smoke:delay`       |      6 | The late-bus alert: the delay ring is claimed before the notification, the arrival message carries the delay, and a second arrival sends nothing |

**The page audit** (`npm run audit`) is the third layer and the only one that
opens a page in a browser. It is described under [The page audit](#the-page-audit)
above.

The suites find real bugs, which is the entire reason they exist. `smoke:admin`
found five on its first run, and `smoke:tracking` found one immediately:
`markWaiting` refused to *clear* the waiting flag after a pick-up but not to *set*
it, so a student could overwrite the driver's `PICKED` with `WAITING`, drop the
bus's onboard count, and leave the "your child is on the bus" notification
already sent quietly untrue. The guards now apply in both directions.

`smoke:boundaries` and `smoke:reconcile` were added later and each caught
something the unit tests structurally could not. The boundaries suite exists
because all four missed pages were *passing* every existing check — no data
leaked — and the failure was only visible in the status code. The reconcile suite
exists because planting a row eight hours old requires either raw SQL or an
explicit `createdAt` on insert, and Prisma re-stamps `updatedAt` on every write,
so a fixture that looks abandoned on inspection is not.

Three limits worth stating plainly:

- An action's id is a build artifact, so a test cannot hardcode it — but it is not
  hidden. Next 16 renders the action as a plain form whose `$ACTION_*` fields are in
  the page HTML, so `scripts/lib/http.ts` scrapes the id off the live page and posts
  exactly those fields back. This README previously claimed these write paths were
  untestable over HTTP; that was wrong, and asserting it wrong is what hid a real
  accessibility bug. `smoke:auth` now posts the sign-in form to prove the throttle
  is wired, and it can only read the response because the auth forms finally carry
  `role="alert"` — the error text it needs was in the markup all along, just not
  announced and not labelled. See `src/components/auth/field-error.tsx`.
- No browser automation is wired up, so nothing here verifies pixels. The smoke
  suites check copy and authorization, not layout. Lighthouse scores the public
  pages but does not click anything either.
- Socket broadcast payload shape is covered by the handshake suite but not by a
  full end-to-end delivery assertion.
- Lighthouse is measured against `/`, `/login` and `/register` on a developer
  laptop. Mobile emulation applies a 4× CPU slowdown and a slow-4G profile, so
  a real phone on a real network will differ — in either direction. All three are
  measured against a production build, not the dev server: React's development
  bundle, unminified code and missing source maps cost 20–30 performance points,
  which is why the dev-server score is not the one quoted anywhere here.
  Authenticated pages are not scored, because a Lighthouse run would have to log
  in first and the number would then depend on the seed rather than the code.

## Design decisions worth knowing

**Sessions are httpOnly cookies, not localStorage.** A token in `localStorage` is
readable by any script on the page. Putting it in an httpOnly, SameSite=Lax
cookie means an XSS bug cannot exfiltrate a long-lived credential.

**`src/proxy.ts` redirects; it does not authorize.** It runs before the page
renders and costs a JWT verification on every matched request, so it stays cheap.
Actual authorization lives in `src/lib/dal.ts`, next to every query that depends
on who is asking — removing the proxy would not make a single query less safe.

What the proxy genuinely adds is the redirect being a real HTTP 307 with an empty
body. A `redirect()` thrown from inside a page render happens *after* React has
begun streaming, so by then the browser already has a 200 with part of the layout,
and the redirect can only travel back as a `<meta http-equiv="refresh">` tag.
Deciding it before a byte of React renders is what makes it a redirect rather
than a flicker.

A prefix absent from that table is a prefix that skips the check entirely, and
the page's own `requireRole` is the only thing left. **Any new page belongs in
the table.**

**Server Action write paths are split into request-scope-free cores.**
`src/lib/attendance.ts` exports functions taking an explicit
`Actor = { userId, role }`; `src/app/actions/portal.ts` is a thin `"use server"`
wrapper. The reason is coverage: actions invoked from client code have no
`$ACTION_*` input to replay and their action ids are build artifacts, so testing
them over HTTP is impossible. Splitting them is what let the `markWaiting` bug
above be found at all.

**The student-to-guardian path is written down once.**
`src/lib/student-scope.ts` owns it. It was originally inlined in four places as
`student: { parentProfile: { userId } }`, which compiles cleanly in some
positions because the union collapses to a laxer branch, and throws at runtime
in all of them. `StudentProfile` has no `parentProfile` field.

**Registration cannot create an admin.** `registerSchema` accepts only `STUDENT`
and `PARENT`, and the Server Action maps the value again on the server.
Accepting a role from the request body would let anyone POST their way into the
admin dashboard.

**`RouteStop` is a join table, not `Stop.order`.** One stop can sit on several
routes and its position differs per route, so the order belongs to the
(route, stop) pair.

**The Socket.IO handshake reuses the session cookie.** No second token, no
`localStorage`. The custom server therefore has to stay out of Socket.IO's way:
engine.io answers `/api/socket/io/` without calling the other request listeners,
so `server.ts` checks `isSocketRequest()` and returns early. Without that guard it
would try to set headers on a finished response and throw
`ERR_HTTP_HEADERS_SENT`.

**Location writes are throttled on two clocks.** A driver's ping is broadcast to
watchers on every message, so the map is smooth, but persisted to Postgres at
most once every 15 seconds, so the database is not.

**The driver's bus is resolved from the database, never from the payload.** A
modified client cannot move a bus it was not assigned to. The same applies to
alerts: the trip is resolved from the caller's own bus or child, so a form
cannot report somebody else's trip.

**GPS fixes are validated before they are believed.** Rejected: stale (over 60s
old), future (more than 30s ahead), blurry (more than 200m worse than the last
accepted fix) and teleports (implying over 160 km/h). The first fix is always
accepted, since there is nothing to compare it against.

**`Date.now()` is never called during render.** `getFleetPositions()` returns
`{ asOf, buses }` so the SQL time window and the TypeScript filter that follows
it agree on a single instant. Computing `now` twice would let a boundary case
disagree with itself. `dayWindow()` follows the same shape, and reads the clock in
a default parameter so a process left running overnight does not go on answering
with yesterday.

**Only `transform` and `opacity` are ever animated.** Those are the two
properties a compositor handles without re-running layout or paint. Animating
`height` or `box-shadow` on an entrance puts main-thread work on every frame of
every animation, which is exactly what Total Blocking Time measures — and the
shadow is transitioned rather than animated, so a hover costs one repaint and
then nothing.

**All motion sits inside `prefers-reduced-motion: no-preference`.** Gating on the
*absence* of the preference means a visitor who asked for reduced motion gets no
animation at all, rather than a cancelled one that still paid for the compositor
work. A bus tracker gets opened in a moving vehicle more often than most apps,
and that is the audience most likely to have the setting on.

**Entrances never fade from `opacity: 0` on the main content.** LCP is recorded
when an element first paints, and an element at `opacity: 0` has not painted, so
a fade pushes the metric out by the length of the fade. `translateY` does not.
Measured: with the stagger in place LCP is 2248 ms, without it 2210 ms — the 38
ms is noise. Motion and the performance score turned out to be genuinely
independent here, and the only way to know that was to take the animation out
and measure again.

**Pinch-zoom is not disabled.** `maximumScale: 1` was in the viewport export,
cargo-culted as "app feel". It fails WCAG 1.4.4, and it fails Lighthouse's
accessibility audit outright: the score read 94 for that reason alone. Zoom is
the only way to magnify text on a phone.

**The mono font is the system stack.** It was a `next/font` family at the root,
which meant a 29 KB woff2 **preload on every page** — including sign-in, where
nothing is monospaced. A preload is high priority by definition, so a font
nobody on that page could see was competing for bandwidth with the resources
LCP was actually waiting on. That was most of the LCP improvement. If a real
mono face is ever wanted, it belongs in the admin layout, not the root one.

**Lighthouse scores `/`, `/login` *and* `/register`, not just the first one.**
The auth pages share a layout but not their markup, and `/register` was sitting at
96 accessibility while `/login` read 100. The cause was the ambient gradient: text
at `slate-500` measures 3.8:1 where a blob drifts behind it, against a 4.5:1
floor, so the failure depended on where the animation happened to be mid-sweep.
Scoring one page would have left it in place indefinitely, because the passing
page says nothing about the failing one. This is the failure mode decorative
backgrounds create — text verified once against a flat colour, then silently
made conditional on animation timing. The landing page joined the set when it
became the third page a stranger can reach: it shares no markup with the auth
screens at all, so the same argument applies with more force.

**An icon is not worth a client entry point.** The icon layer started as a
`"use client"` module wrapping `lucide-react`, on the reasoning that lucide's own
components sit behind that boundary and so the whole set should live on one side
of the same fence. That reasoning is sound and the conclusion was still expensive:
a `"use client"` module is a client *entry point*, so every page whose graph
touched an icon — the public landing and sign-in pages included — pulled the
entire set into the browser and evaluated it. Measured against the landing page,
that was **429 ms of Total Blocking Time and a performance score of 86**. Left as
a plain module, the same icons are rendered to static SVG during the server pass
and only the glyphs a Client Component actually renders ship: the page now
**scores 98 with 42 ms of blocking time**, and `/login` and `/register` move with
it. The string-keyed registry survives because it has to — a component is not
serialisable, so `PortalShell` (a Client Component) receives `icon: IconName` and
resolves it, and the union keeps a typo a compile error. What changed is only
which side of the boundary that registry lives on. The lesson is that
`"use client"` is not a tag you add to be safe; it is a decision about what the
browser downloads and runs, and it is worth measuring before believing it.

**A trip's status column is not proof that a trip is alive.** `ONGOING` is set by
`startTrip` and cleared by `completeTrip`, and nothing owns the trip in between.
A dead phone, a discarded tab, a mid-run restart — each leaves the row `ONGOING`
forever, which keeps its bus looking live, blocks the driver from starting the
next run, and adds an unfinished run to every report. Liveness is therefore
decided by recent activity, in a pure module, with the bus ping clamped to the
trip's own lifetime so that a later trip's ping cannot keep an earlier dead one
open.

**Opening the notifications inbox marks it read on the server**, in the same
render, with `newCount` passed through. A client effect would fire a second
request after the page had already painted, and the "N new" badge would depend
on which of the two landed first.

**Real foreign keys, not Prisma's `relationMode = "prisma"`.** That mode is for
edge cases like PlanetScale or MongoDB. On PostgreSQL it silently gives up
referential integrity and lets orphan rows accumulate.

**Maps are built as escaped HTML strings inside popups.** Since the popup body
comes off a socket, every interpolated value goes through `escapeHtml`, and the
only link allowed is one that passes `localHref()`, which rejects absolute URLs,
protocol-relative `//`, backslashes, quotes and whitespace.

## Environment variables

| Variable                       | Required | Purpose                                        |
| ------------------------------ | -------- | ---------------------------------------------- |
| `DATABASE_URL`                 | yes      | PostgreSQL connection string                   |
| `AUTH_SECRET`                  | yes      | 32+ characters, signs the session cookie       |
| `NEXT_PUBLIC_APP_URL`          | yes      | Public origin, for absolute URLs               |
| `NEXT_PUBLIC_MAP_TILE_URL`     | no       | Tile template; defaults to OSM (dev only)      |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | no       | Web push, browser half                         |
| `VAPID_PRIVATE_KEY`            | no       | Web push, server half                          |
| `VAPID_SUBJECT`                | no       | Web push contact address                       |
| `OSRM_URL`                     | no       | OSRM server, defaults to the public instance   |
| `PORT`                         | no       | Defaults to 3000                               |
| `HOSTNAME`                     | no       | Defaults to 0.0.0.0                            |

Push with all three VAPID variables empty is a supported configuration, not a
mistake: `push.ts` treats missing keys as "this deployment does not do push" and
returns quietly, and the in-app inbox keeps working.

`.env` is git-ignored. Never commit it. `.env.example` carries the full
documentation.
