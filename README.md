# Navika

Student-aware smart college and school bus management and tracking.

Most bus tracking products show a dot on a map. Navika tracks **people**: which
student is assigned to which bus, which stop they board at, whether they have
stepped out of the house yet, and whether they actually got picked up. That is
what makes it useful to a parent at 7:40 in the morning.

## What is built so far

**Phase 0 â€” foundation (done)**

- Next.js 16 App Router, TypeScript, Tailwind v4
- PostgreSQL via Prisma 7 with a 17-model schema
- Session auth: httpOnly cookie, `jose` JWT, four roles
- Role-gated dashboards for student, parent, driver and admin
- Socket.IO attached to a custom Node server, with cookie-based handshake
- Demo seed: 3 routes, 12 stops, 5 buses, 6 drivers, 40 students, 8 parents,
  two live trips

Live maps, ETA via OSRM, waiting-count sync and push notifications land in
Phases 2 to 4.

## Stack

| Concern            | Choice                            | Why                                                              |
| ------------------ | --------------------------------- | ---------------------------------------------------------------- |
| Framework          | Next.js 16 (App Router, Turbopack)| Server Components for data-heavy dashboards, one deploy target    |
| Database           | PostgreSQL 17 + Prisma 7          | Real foreign keys and transactions, no MongoDB workarounds        |
| Auth               | `jose` JWT in an httpOnly cookie  | No token in `localStorage` for XSS to steal                       |
| Realtime           | Socket.IO on a custom Node server | WebSocket fan-out for live positions                              |
| Maps               | MapLibre GL + OpenStreetMap       | No API key, no billing, no Google lock-in                        |
| ETA                | OSRM public API, haversine backup | Road-accurate when available, never a hard dependency            |
| Validation         | Zod v4                            | One schema shared by form and Server Action                       |

**Deploy on a Node host** (Render, Railway, Fly, a VPS). Not Vercel: Socket.IO
needs a persistent connection and does not work on Vercel's serverless runtime.

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

### Port note

ZyniVerse already uses port 3000. If you want Navika on a different port:

```powershell
$env:PORT = '3010'; npm run dev
```

### Demo accounts

Password for all of them: `navika123`

| Role    | Email                               |
| ------- | ----------------------------------- |
| Admin   | `admin@navika.test`                 |
| Driver  | `driver1@navika.test`               |
| Parent  | `parent1@navika.test`               |
| Student | `aarav.sharma0@student.navika.test` |

## Scripts

| Command                | What it does                                        |
| ---------------------- | --------------------------------------------------- |
| `npm run dev`          | Custom server: Next.js in dev + Socket.IO           |
| `npm run build`        | Production build                                    |
| `npm start`            | Custom server in production mode                    |
| `npm run typecheck`    | `tsc --noEmit`                                      |
| `npm run lint`         | ESLint                                              |
| `npm run test`         | Vitest                                              |
| `npm run smoke`        | Realtime smoke test against a running server        |
| `npm run smoke:auth`   | Log in as every demo account, check dashboards      |
| `npm run smoke:all`    | Both smoke tests                                    |
| `npm run setup:db`     | One-time database provisioning                      |
| `npm run db:start`     | Start the local database cluster (needed after boot) |
| `npm run db:migrate`   | Create and apply a migration in development         |
| `npm run db:deploy`    | Apply pending migrations (production, CI)           |
| `npm run db:seed`      | Reset to a believable demo dataset                  |
| `npm run db:studio`    | Prisma Studio                                       |
| `npm run db:reset`     | Drop, re-migrate and re-seed                        |
| `npm run setup`        | All three setup steps in order                      |

### Port

`npm run dev` uses `PORT`, falling back to 3000. If something else on your
machine already holds 3000, either stop it or pick another port:

```powershell
$env:PORT = "3010"; npm run dev
```

### Realtime smoke test

`npm run smoke` checks the parts of the realtime layer that need no database:
an anonymous client is refused, a correctly signed session cookie is accepted,
and a forged cookie is refused. Start the server first, then:

```bash
npm run smoke            # assumes port 3000
npm run smoke 3010       # or pass the port explicitly
```

## Project layout

```
prisma/
  schema.prisma        17 models, real FK constraints
  seed.ts              demo dataset
scripts/
  setup-db.ps1         one-time database provisioning
server.ts              custom Node server: Next.js + Socket.IO
src/
  app/
    (auth)/            login, register
    (portal)/          student, parent, driver, admin dashboards
    actions/           Server Actions
  components/          UI primitives and feature components
  lib/
    db.ts              Prisma singleton with the pg driver adapter
    session.ts         cookie read/write (Next.js side)
    dal.ts             authorization: requireSession, requireRole, getCurrentUser
    queries.ts         scoped read helpers
    socket-events.ts   the realtime contract, shared by server and browser
    realtime.ts        browser socket singleton and hooks
    geo.ts             haversine, bearing, ETA fallback
    validations.ts     Zod schemas
  server/
    session-core.ts    JWT crypto with no framework dependency
    socket.ts          Socket.IO wiring, rooms, throttling
  proxy.ts             optimistic route redirects (Next 16 renamed middleware)
  generated/prisma/    generated client (git-ignored)
```

## Design decisions worth knowing

**Sessions are httpOnly cookies, not localStorage.** A token in `localStorage`
is readable by any script that runs on the page. Putting it in an httpOnly,
SameSite=Lax cookie means an XSS bug cannot exfiltrate a long-lived credential.

**`src/proxy.ts` only redirects; it does not authorize.** It runs before the
page renders and costs a JWT verification on every matched request, so it stays
cheap. Actual authorization lives in `src/lib/dal.ts`, next to every query that
depends on who is asking. A redirect in the proxy is a UX nicety, not a
security boundary.

**Registration cannot create an admin.** `registerSchema` accepts only
`STUDENT` and `PARENT`, and the Server Action maps the value again on the
server. Accepting a role from the request body would let anyone POST their way
into the admin dashboard.

**`RouteStop` is a join table, not `Stop.order`.** One stop can sit on several
routes, and its position differs per route, so the order belongs to the
(route, stop) pair.

**The Socket.IO handshake reuses the session cookie.** No second token, no
`localStorage`. The custom server therefore has to stay out of Socket.IO's way:
engine.io answers `/api/socket/io/` without calling the other request listeners,
so `server.ts` checks `isSocketRequest()` and returns early. Without that guard
it would try to set headers on a finished response and throw
`ERR_HTTP_HEADERS_SENT`.

**Location writes are throttled on two clocks.** A driver's ping is broadcast
to watchers on every message (so the map is smooth) but persisted to Postgres
at most once every 15 seconds (so the database is not). A separate 2-second
floor per socket stops a misbehaving client from flooding the bus room.

**The driver's bus is resolved from the database, never from the payload.** A
modified client cannot move a bus it was not assigned to.

**Real foreign keys, not Prisma's `relationMode = "prisma"`.** That mode is for
edge cases like PlanetScale or MongoDB. On PostgreSQL it silently gives up
referential integrity and lets orphan rows accumulate.

## Roadmap

- [x] Phase 0 â€” schema, auth, dashboards, realtime plumbing
- [ ] Phase 1 â€” CRUD: stops, routes, buses, drivers, enrolments, trip scheduling
- [ ] Phase 2 â€” MapLibre maps, route polyline, stop markers, OSRM ETA
- [ ] Phase 3 â€” Driver PWA with `watchPosition`, live map, simulator mode
- [ ] Phase 4 â€” "I am waiting" sync, pick-up check-off, notifications, web push
- [ ] Phase 5 â€” Attendance history, exports, PWA polish, deployment

## Environment variables

| Variable                 | Required | Purpose                                       |
| ------------------------ | -------- | --------------------------------------------- |
| `DATABASE_URL`           | yes      | PostgreSQL connection string                  |
| `AUTH_SECRET`            | yes      | 32+ characters, signs the session cookie      |
| `NEXT_PUBLIC_APP_URL`    | yes      | Public origin, for absolute URLs              |
| `OSRM_URL`               | no       | OSRM server, defaults to the public instance  |
| `VAPID_PUBLIC_KEY`       | no       | Web push, Phase 4                             |
| `VAPID_PRIVATE_KEY`      | no       | Web push, Phase 4                             |
| `VAPID_SUBJECT`          | no       | Web push contact address                      |
| `PORT`                   | no       | Defaults to 3000                              |

`.env` is git-ignored. Never commit it.

