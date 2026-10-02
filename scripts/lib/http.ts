/**
 * HTTP helpers shared by the smoke scripts and the map tour.
 *
 * These were copy-pasted into each script with small differences, and the
 * differences were not cosmetic: one logged in with a URL-encoded body and a
 * pre-session cookie, another with multipart form data and the `$ACTION_*`
 * hidden inputs that Next needs. Only the second worked, and the first reported
 * a wall of 307s that looked like an application bug rather than a broken
 * client.
 *
 * Next 16 renders a Server Action as a plain HTML form with hidden `$ACTION_*`
 * inputs posted back to the same URL. There is no `next-action` header. So
 * replaying one means posting exactly those fields, and the only way to be sure
 * that stays true is to have one implementation of it.
 *
 * Pure Node, no Prisma and no Next imports, so it runs under plain `tsx`.
 */

export const DEMO_PASSWORD = "navika123";

/** Cookie name, matched from the `Set-Cookie` header the login action emits. */
const SESSION_COOKIE = "navika_session=";

/**
 * The port the app under test is listening on.
 *
 * `PORT` from `.env` first so these scripts follow the server instead of
 * disagreeing with it, then an explicit argument for testing another port.
 */
export function resolveBase(argv: string[] = process.argv.slice(2)): string {
  const port = argv[0] ?? process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x3D;/g, "=");
}

/**
 * Text a person would see on the page.
 *
 * React escapes everything, so an assertion against `"Bus & Co"` has to be made
 * against the decoded text, and against tags stripped, or it passes against
 * markup the user never reads.
 */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Text of every `role="alert"` block, which is where this app puts errors. */
export function errorText(html: string): string {
  return [...html.matchAll(/role="alert"[^>]*>([\s\S]*?)<\/[^>]+>/g)]
    .map((m) => visibleText(m[1] ?? ""))
    .join(" | ");
}

/** All forms on a page, with both the raw markup and the visible text. */
export function forms(html: string): { text: string; raw: string }[] {
  return [...html.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => ({
    text: visibleText(m[0]),
    raw: m[0],
  }));
}

/**
 * Fill in the hidden `$ACTION_*` fields a Server Action form carries.
 *
 * These are how Next 16 identifies which action to run. Dropping them posts a
 * valid-looking form that silently does nothing, which is a genuinely confusing
 * failure to debug from the outside.
 */
function actionFields(form: string, body: FormData): void {
  for (const tag of form.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []) {
    const name = decodeEntities(tag.match(/name="([^"]*)"/)?.[1] ?? "");
    if (!name.startsWith("$ACTION")) continue;
    body.set(name, decodeEntities(tag.match(/value="([^"]*)"/)?.[1] ?? ""));
  }
}

/** A session cookie, and a `fetch` that carries it. */
export type Session = {
  cookie: string;
  get: (path: string) => Promise<{ status: number; html: string; location: string }>;
  submit: (
    path: string,
    marker: string,
    values: Record<string, string>,
  ) => Promise<{ status: number; html: string; location: string }>;
};

/**
 * Log in and return a session.
 *
 * Fails loudly rather than returning an unauthenticated session, because every
 * assertion after a silent login failure is a 307 and the real cause is gone.
 */
export async function login(
  base: string,
  email: string,
  password: string = DEMO_PASSWORD,
): Promise<Session> {
  const page = await fetch(`${base}/login`);
  const html = await page.text();

  const form = forms(html).find((f) => f.text.toLowerCase().includes("sign in"));
  if (!form) throw new Error(`no sign-in form at ${base}/login`);

  const body = new FormData();
  actionFields(form.raw, body);
  body.set("email", email);
  body.set("password", password);

  const res = await fetch(`${base}/login`, {
    method: "POST",
    body,
    redirect: "manual",
  });

  const issued = res.headers.getSetCookie?.() ?? [];
  const session = issued.find((h) => h.startsWith(SESSION_COOKIE));
  const cookie = session?.split(";")[0] ?? "";
  if (!cookie) {
    throw new Error(
      `login as ${email} did not set ${SESSION_COOKIE} (status ${res.status}). ` +
        `Wrong password, or the seed data is missing.`,
    );
  }

  const fetchWithCookie = async (path: string, init?: RequestInit) =>
    fetch(`${base}${path}`, {
      ...init,
      redirect: "manual",
      headers: { ...init?.headers, cookie },
    });

  return {
    cookie,

    async get(path) {
      const res = await fetchWithCookie(path);
      return {
        status: res.status,
        html: await res.text(),
        location: res.headers.get("location") ?? "",
      };
    },

    /**
     * Replay the Server Action in the form containing `marker`, overriding its
     * visible fields with `values`.
     */
    async submit(path, marker, values) {
      const page = await fetchWithCookie(path);
      const pageHtml = await page.text();
      const target = forms(pageHtml).find((f) => f.text.includes(marker));
      if (!target) throw new Error(`no form containing "${marker}" on ${path}`);

      const body = new FormData();
      actionFields(target.raw, body);
      for (const [k, v] of Object.entries(values)) body.set(k, v);

      const res = await fetchWithCookie(path, { method: "POST", body });
      return {
        status: res.status,
        html: await res.text(),
        location: res.headers.get("location") ?? "",
      };
    },
  };
}

/** Follow a Server Action redirect and return the page it lands on. */
export async function follow(
  base: string,
  session: Session,
  location: string,
): Promise<{ status: number; html: string }> {
  if (!location) return { status: 0, html: "" };
  const res = await session.get(location);
  return { status: res.status, html: res.html };
}
