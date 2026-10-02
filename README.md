# Navika

Student-aware smart college and school bus management and tracking.

Most bus tracking products show a dot on a map. Navika tracks **people**: which
student is assigned to which bus, which stop they board at, whether they have
stepped out of the house yet, and whether they actually got picked up. That is
what makes it useful to a parent at 7:40 in the morning.

## What is built

All five phases are complete and verified.

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

- Dockerfile, multi-stage, running as a non-root user
- `render.yaml` blueprint including a managed Postgres
- `/api/health` for the load balancer, which distinguishes an unreachable
  database from an un-migrated one
- 156 unit tests and 161 smoke checks across four suites

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

**Deploy on a Node host** (Render, Railway, Fly, a VPS, Docker). Not Vercel:
Socket.IO needs a persistent connection and does not work on Vercel's
serverless runtime.

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
| `npm start`             | Custom server in production mode                         |
| `npm run typecheck`     | `tsc --noEmit`                                           |
| `npm run lint`          | ESLint                                                   |
| `npm run test`          | Vitest, pure logic only                                  |
| `npm run verify`        | typecheck + lint + test + build                          |
| `npm run smoke`         | Realtime handshake against a running server              |
| `npm run smoke:auth`    | Log in as every role, check the dashboards render        |
| `npm run smoke:admin`   | Admin CRUD and trip lifecycle against a running server   |
| `npm run smoke:tracking`| Tracking, attendance, alerts, notifications              |
| `npm run smoke:all`     | All four smoke suites                                    |
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
| `npm run docker:build`  | Build the production image                               |
| `npm run docker:run`    | Run it on 3010 against `.env`                            |

The smoke suites need a running dev server and a live database. Start both, then
run them.

## Deploying

### Docker

```bash
npm run docker:build
npm run docker:run
```

The image runs as a non-root user and has a `HEALTHCHECK` that calls the real
`/api/health`, so a process that is up but cannot reach Postgres is reported
unhealthy rather than passing on a hardcoded 200.

Migrations are **not** run at container start. Two containers booting together
would race each other, and a half-applied migration is worse than a failed
deploy. Apply them once as a release step, before the new container serves
traffic:

```bash
npx prisma migrate deploy
```

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
  smoke-*.ts             HTTP suites against a running server
  map-tour.ts            offscreen render of every route
  find-broken-line.mjs   locate the first line that breaks parsing
  lib/http.ts            shared smoke helpers
server.ts                custom Node server: Next.js + Socket.IO
Dockerfile               multi-stage production image
render.yaml              Render blueprint, incl. managed Postgres
src/
  app/
    (auth)/              login, register
    (portal)/
      admin/             CRUD, trips, reports, alerts
      driver/            today's trip, checklist, GPS panel
      student/ parent/   dashboards, fleet, track, notifications, install
    actions/             Server Actions, thin wrappers over lib cores
    api/health/          load balancer health check
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
    queries.ts           scoped read helpers
    geo.ts               haversine, bearing, ETA fallback
    osrm.ts              routing client
    osrm-parse.ts        response parsing, no network
    route-order.ts       stop ordering, no DB
    tracking.ts          GPS acceptance and freshness, pure
    fleet-filter.ts      one definition of "reportable as live"
    tracking-queries.ts  scoped tracking reads
    student-scope.ts     the student/guardian relation path, in one place
    attendance.ts        attendance and alert write cores, request-scope-free
    notifications.ts     notification fan-out
    push.ts              web push with dead-endpoint pruning
    health.ts            health-check classification, pure
    validations.ts       Zod schemas
    utils.ts             formatting
  server/
    session-core.ts      JWT crypto with no framework dependency
    socket.ts            Socket.IO wiring, rooms, throttling
  proxy.ts               optimistic route redirects (Next 16 renamed middleware)
  generated/prisma/      generated client (git-ignored)
```

## Testing

Two layers, because they catch different things.

**Unit tests** (`npm run test`, 156 assertions) cover the logic where a bug is
invisible from the outside: GPS acceptance, ETA parsing, stop ordering,
freshness decay, and health classification. These modules deliberately import
nothing from the database, the network or the DOM, which is what makes them
testable at all - and is why they use relative sibling imports rather than
`@/lib/...`, because Vitest has no path-alias configuration here.

**Smoke suites** (`npm run smoke:all`, 161 checks over four suites) run against a
real server and a real database, because the bugs that matter most here are
authorization bugs, and those only appear when a real session meets a real row:

| Suite           | Covers                                                       |
| --------------- | ------------------------------------------------------------ |
| `smoke`         | Socket handshake: anonymous refused, valid cookie accepted, forged cookie refused |
| `smoke:auth`    | Every role can log in and its dashboard renders with data      |
| `smoke:admin`   | CRUD, referential guards, trip lifecycle, attendance reports  |
| `smoke:tracking`| Authorization on `/track`, the driver checklist, attendance writes and their refusals, notification fan-out, alerts, the health endpoint |

The suites find real bugs. `smoke:admin` found five on its first run, and
`smoke:tracking` found one immediately: `markWaiting` refused to *clear* the
waiting flag after a pick-up but not to *set* it, so a student could overwrite
the driver's `PICKED` with `WAITING`, drop the bus's onboard count, and leave
the "your child is on the bus" notification already sent quietly untrue. The
guards now apply in both directions.

Three limits worth stating plainly:

- Server Actions called from client components cannot be HTTP-tested. Next 16
  renders them as plain forms with hidden `$ACTION_*` inputs, and the
  `Next-Action` id is a build artifact. Those write paths are covered by calling
  the underlying core directly, which is why the cores take an explicit
  `Actor` and live outside the request scope.
- No browser automation is wired up, so nothing here verifies pixels. The smoke
  suites check copy and authorization, not layout.
- Socket broadcast payload shape is covered by the handshake suite but not by a
  full end-to-end delivery assertion.

## Design decisions worth knowing

**Sessions are httpOnly cookies, not localStorage.** A token in `localStorage` is
readable by any script on the page. Putting it in an httpOnly, SameSite=Lax
cookie means an XSS bug cannot exfiltrate a long-lived credential.

**`src/proxy.ts` only redirects; it does not authorize.** It runs before the page
renders and costs a JWT verification on every matched request, so it stays cheap.
Actual authorization lives in `src/lib/dal.ts`, next to every query that depends
on who is asking. A redirect in the proxy is a UX nicety, not a security
boundary.

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
disagree with itself.

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
