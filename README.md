# Navika

Student-aware smart college and school bus management and tracking.

Most bus tracking products show a dot on a map. Navika tracks **people**: which
student is assigned to which bus, which stop they board at, whether they have
stepped out of the house yet, and whether they actually got picked up. That is
what makes it useful to a parent at 7:40 in the morning.

## What is built

Everything below is implemented, wired up and verified. The six phases were
built in order, then four further areas landed on top of them after the
roadmap was first met; those are listed under **Beyond the roadmap** rather than
folded into the phase they relate to.

Current state: **typecheck and lint clean, 309 unit tests, 220 HTTP smoke
checks across six suites, 36 routes building.**

**Phase 0 - foundation**

- Next.js 16 App Router, TypeScript, Tailwind v4
- PostgreSQL 17 via Prisma 7, 18 models and 9 enums with real foreign keys
- Session auth: httpOnly cookie, `jose` JWT, four roles
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

**Beyond the roadmap** — four areas built after the six phases were met:

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

Navika uses its **own** PostgreSQL cluster at `C:\navika-pg` on **port 5433**, so
it never touches the PostgreSQL 17 service on 5432 that belongs to ZyniVerse.

```bash
npm run setup:db
```

That script initialises the cluster, creates the `navika` role and `navika`
database with a generated password, switches its `pg_hba.conf` to
`scram-sha-256`, and writes `.env` for you.

If you would rather do it by hand against an existing server:

```sql
CREATE ROLE navika LOGIN PASSWORD 'pick-something';
CREATE DATABASE navika OWNER navika;
ALTER ROLE navika CREATEDB;   -- Prisma needs this to create the shadow database
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

> **After a reboot**, start the database first with `npm run db:start`. It is a
> plain process, not a Windows service, so it does not come up on its own. To
> make that permanent, register it once as Administrator:
>
> ```powershell
> & "$env:ProgramFiles\PostgreSQL\17\bin\pg_ctl.exe" register -N "NavikaPG" -D "C:\navika-pg" -S auto
> ```

### Port

`npm run dev` reads `PORT`, falling back to 3000. ZyniVerse already uses 3000,
so Navika's `.env` sets `PORT=3010`. It belongs in `.env` rather than only in
the shell that happened to start the server, or the next `npm run dev` silently
collides.

### Demo accounts

Password for all of them: `navika123`

| Role    | Email                               |
| ------- | ----------------------------------- |
| Admin   | `admin@navika.test`                 |
| Driver  | `driver1@navika.test`               |
| Driver  | `driver2@navika.test`               |
| Parent  | `parent1@navika.test`               |
| Student | `aarav.sharma0@student.navika.test` |

The seed stamps bus positions with `lastLocationAt` at seed time, so they fall
outside the two-minute live window a couple of minutes after seeding. Open
`/fleet` right after seeding, or restamp:

```bash
npm run db:seed && npm run smoke:tracking
```

## Scripts

| Command                 | What it does                                             |
| ----------------------- | -------------------------------------------------------- |
| `npm run dev`           | Custom server: Next.js in dev + Socket.IO                |
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
| `npm run smoke:all`     | All six smoke suites                                     |
| `npm run map:tour`      | Walk every route through the map renderer, offscreen     |
| `npm run check:osrm`    | Is the configured OSRM server reachable and sane?        |
| `npm run setup:db`      | One-time database provisioning                           |
| `npm run db:start`      | Start the local database cluster (needed after boot)     |
| `npm run db:migrate`    | Create and apply a migration in development              |
| `npm run db:deploy`     | Apply pending migrations (production, CI)                |
| `npm run db:seed`       | Reset to a believable demo dataset                       |
| `npm run db:studio`     | Prisma Studio                                            |
| `npm run db:reset`      | Drop, re-migrate and re-seed                             |
| `npm run setup`         | All three setup steps in order                           |
| `npm run lighthouse`    | Score the app and fail on a regression                    |

The smoke suites need a running dev server and a live database. Start both, then
run them.

```
npm run db:start      # if the machine has just rebooted
npm run db:seed       # resets to a demo dataset, and restores live trips
npm start &           # or npm run dev
npm run smoke:all
```

`smoke:admin` and `smoke:tracking` write to and clean up after themselves, but
both expect the seed: `smoke:tracking` in particular needs two `ONGOING` trips
and will say so plainly rather than failing obscurely if the database is bare.

## Deploying

There is no container image. Navika is a plain long-lived Node process, and the
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

Not yet, and deliberately not configured. Socket.IO broadcasts from whichever
process holds a driver's connection, so with two instances a parent connected to
the other one sees nothing move. `render.yaml` pins `numInstances: 1`. Going
wider needs a Redis adapter first, which is a real piece of work rather than a
config line.

## Project layout

```
prisma/
  schema.prisma          18 models, 9 enums, real FK constraints
  seed.ts                demo dataset
scripts/
  setup-db.ps1           one-time database provisioning
  start-db.ps1           start the local cluster after a reboot
  smoke-*.ts             six HTTP suites against a running server
  smoke-reconcile.ts     abandoned-trip reconciliation, on real rows
  smoke-boundaries.ts    route and role boundaries, end to end
  map-tour.ts            offscreen render of every route
  check-osrm.ts          is the routing server reachable and sane?
  lighthouse.mjs         score the app, fail on a regression
  find-broken-line.mjs   locate the first line that breaks parsing
  lib/http.ts            shared smoke helpers
server.ts                custom Node server: Next.js + Socket.IO
render.yaml              Render blueprint, incl. managed Postgres
src/
  app/
    (auth)/              login, register
    (portal)/
      admin/             CRUD, trips, reports, alerts
      driver/            today's trip, checklist, GPS panel
      student/ parent/   dashboards, fleet, track, notifications, install
      error.tsx loading.tsx not-found.tsx   boundary files
    actions/             Server Actions, thin wrappers over lib cores
    api/health/          load balancer health check
    api/admin/**/route.ts three guarded CSV export endpoints
  components/
    map/                 MapLibre canvas, route editor, vehicle popups
    tracking/            driver tracker, live map, fleet map
    driver/ notifications/ admin/ auth/ portal/ ui/
  hooks/
    use-driver-tracker   watchPosition state machine
  lib/
    db.ts                Prisma singleton with the pg driver adapter
    session.ts           cookie read/write (Next.js side)
    dal.ts               authorization: requireSession, requireRole
    api-auth.ts          API-side guard, returns 401/403 not a redirect
    queries.ts           scoped read helpers
    day-window.ts        "today" as one half-open local range, pure
    geo.ts               haversine, bearing, ETA fallback
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
    socket.ts            Socket.IO wiring, rooms, throttling
    simulator-runner.ts  the interval, the writes, the broadcast
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

**Unit tests** (`npm run test`, 309 assertions over 12 files) cover the logic
where a bug is invisible from the outside: GPS acceptance, ETA parsing, stop
ordering, freshness decay, CSV escaping, route-movement maths, trip liveness,
and health classification. These modules deliberately import nothing from the
database, the network or the DOM, which is what makes them testable at all — and
is why they use relative sibling imports rather than `@/lib/...`, because Vitest
has no path-alias configuration here.

**Smoke suites** (`npm run smoke:all`, 220 checks over six suites) run against a
real server and a real database, because the bugs that matter most here are
authorization bugs, and those only appear when a real session meets a real row:

| Suite               | Checks | Covers                                                       |
| ------------------- | -----: | ------------------------------------------------------------ |
| `smoke`             |      3 | Socket handshake: anonymous refused, valid cookie accepted, forged cookie refused |
| `smoke:auth`        |     13 | Every role can log in and its dashboard renders with data      |
| `smoke:admin`       |     48 | CRUD, referential guards, trip lifecycle, attendance reports  |
| `smoke:tracking`    |     95 | Authorization on `/track`, the driver checklist, attendance writes and their refusals, notification fan-out, alerts, the health endpoint |
| `smoke:reconcile`   |     10 | Abandoned trips close; live ones are left alone                |
| `smoke:boundaries`  |     51 | 28 pages requested anonymously, a 4×4 role matrix, deep links, forged cookies, the API |

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

- Server Actions called from client components cannot be HTTP-tested. Next 16
  renders them as plain forms with hidden `$ACTION_*` inputs, and the
  `Next-Action` id is a build artifact. Those write paths are covered by calling
  the underlying core directly, which is why the cores take an explicit
  `Actor` and live outside the request scope.
- No browser automation is wired up, so nothing here verifies pixels. The smoke
  suites check copy and authorization, not layout. Lighthouse scores the public
  pages but does not click anything either.
- Socket broadcast payload shape is covered by the handshake suite but not by a
  full end-to-end delivery assertion.
- Lighthouse is measured against `/login` on a developer laptop. Mobile emulation
  applies a 4× CPU slowdown and a slow-4G profile, so a real phone on a real
  network will differ — in either direction.

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
