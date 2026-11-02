import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { CalendarView, ConfigPatch, EventView, FeedConfig } from "../shared/types.ts";
import { type Credentials, credentialsHash, credentialsQuery, parseCredentials, redact } from "./credentials.ts";
import { processCalendar } from "./pipeline.ts";
import { applyPatch, type ConfigStore, configPatchSchema } from "./store.ts";
import { type CalendarSource, UpstreamError } from "./tumonline.ts";

export interface AppOptions {
  source: CalendarSource;
  store: ConfigStore;
  /** Public base URL, e.g. https://cal.example.com. Derived from the request if unset. */
  publicUrl?: string;
  /** When false, only feeds that already logged in once can be used. */
  openRegistration: boolean;
  /** Directory of the built web UI. */
  staticDir?: string;
  log?: (line: string) => void;
}

/** Header the web UI sends its credentials in (as a query string: pStud=…&pToken=…). */
export const CREDENTIALS_HEADER = "X-Calendar-Credentials";

type Env = { Variables: { creds: Credentials; hash: string } };

export function createApp(opts: AppOptions) {
  const app = new Hono<Env>();
  const log = opts.log ?? console.log;

  const baseUrl = (c: Context) => {
    if (opts.publicUrl) return opts.publicUrl.replace(/\/+$/, "");
    const url = new URL(c.req.url);
    const proto = c.req.header("x-forwarded-proto")?.split(",")[0].trim() ?? url.protocol.replace(":", "");
    const host = c.req.header("x-forwarded-host")?.split(",")[0].trim() ?? c.req.header("host") ?? url.host;
    return `${proto}://${host}`;
  };

  const allowed = async (hash: string) => opts.openRegistration || (await opts.store.exists(hash));

  async function buildView(c: Context<Env>, config: FeedConfig, refresh = false): Promise<CalendarView> {
    const creds = c.get("creds");
    const base = baseUrl(c);
    const fetched = await opts.source(creds, { refresh });
    const result = processCalendar(fetched.ics, config, { eventUrl: (uid) => eventUrl(base, uid) });
    const query = credentialsQuery(creds);
    return {
      calendarName: result.calendarName,
      feedUrl: `${base}/cal.ics?${query}`,
      loginUrl: `${base}/?${query}`,
      config,
      courses: result.courses,
      events: result.events,
      fetchedAt: fetched.fetchedAt.toISOString(),
    };
  }

  app.use(async (c, next) => {
    const started = Date.now();
    await next();
    if (c.req.path !== "/health") {
      log(`${c.req.method} ${redact(c.req.path)} ${c.res.status} ${Date.now() - started}ms`);
    }
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof UpstreamError) return c.json({ error: err.message }, err.status as 401 | 502);
    log(`error: ${redact(String(err?.stack ?? err))}`);
    return c.json({ error: "Internal server error" }, 500);
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  // The calendar feed that calendar apps subscribe to.
  app.get("/cal.ics", async (c) => {
    const creds = parseCredentials(new URL(c.req.url).search);
    if (!creds) return c.text("Missing or invalid pStud/pPers and pToken parameters.", 400);
    const hash = credentialsHash(creds);
    if (!(await allowed(hash))) return c.text("This calendar is not registered on this server.", 403);

    const base = baseUrl(c);
    const [fetched, config] = await Promise.all([opts.source(creds), opts.store.get(hash)]);
    const { ics } = processCalendar(fetched.ics, config, { eventUrl: (uid) => eventUrl(base, uid) });
    return c.body(ics, 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="tum.ics"',
      "Cache-Control": "no-store",
    });
  });

  const api = new Hono<Env>();
  api.use(bodyLimit({ maxSize: 512 * 1024 }));

  api.post("/login", async (c) => {
    const body = await c.req.json<{ url?: string }>().catch(() => ({ url: undefined }));
    const creds = parseCredentials(body.url);
    if (!creds) {
      throw new HTTPException(400, {
        message: "That doesn't look like a TUMonline calendar link (pStud/pPers and pToken are missing).",
      });
    }
    const hash = credentialsHash(creds);
    if (!(await allowed(hash)))
      throw new HTTPException(403, { message: "Registration of new calendars is closed on this server." });
    await opts.source(creds, { refresh: true }); // verifies the token with TUMonline
    await opts.store.ensure(hash);
    return c.json({ credentials: credentialsQuery(creds) });
  });

  api.use(async (c, next) => {
    const creds = parseCredentials(c.req.header(CREDENTIALS_HEADER));
    if (!creds) throw new HTTPException(401, { message: "Not logged in." });
    const hash = credentialsHash(creds);
    if (!(await allowed(hash)))
      throw new HTTPException(403, { message: "This calendar is not registered on this server." });
    c.set("creds", creds);
    c.set("hash", hash);
    await next();
  });

  api.get("/calendar", async (c) => {
    const config = await opts.store.get(c.get("hash"));
    return c.json(await buildView(c, config, c.req.query("refresh") === "1"));
  });

  api.patch("/config", async (c) => {
    const parsed = configPatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: `Invalid change: ${parsed.error.message}` });
    const patch: ConfigPatch = parsed.data;

    // Remember each event's course + start time, so a rule survives TUMonline changing the UID.
    if (patch.events) {
      const current = await buildView(c, await opts.store.get(c.get("hash")));
      const fallbacks = new Map<string, string>();
      for (const e of current.events) for (const uid of [e.uid, ...e.mergedUids]) fallbacks.set(uid, e.fallbackKey);
      for (const [uid, rule] of Object.entries(patch.events)) {
        const fallbackKey = fallbacks.get(uid);
        if (rule && fallbackKey) rule.fallbackKey = fallbackKey;
      }
    }

    const config = await opts.store.update(c.get("hash"), (cfg) => applyPatch(cfg, patch));
    return c.json(await buildView(c, config));
  });

  api.get("/events/:uid", async (c) => {
    const uid = c.req.param("uid");
    const view = await buildView(c, await opts.store.get(c.get("hash")));
    const event = view.events.find((e) => e.uid === uid || e.mergedUids.includes(uid));
    if (!event) throw new HTTPException(404, { message: "This event is no longer in your TUMonline calendar." });
    const course = view.courses.find((co) => co.key === event.courseKey);
    if (!course) throw new HTTPException(404, { message: "Course not found." });
    return c.json({ event, course, config: view.config } satisfies EventView);
  });

  app.route("/api", api);
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  // Web UI: static assets plus SPA fallback for client-side routes like /event/:uid.
  const indexFile = opts.staticDir && join(opts.staticDir, "index.html");
  if (opts.staticDir && indexFile && existsSync(indexFile)) {
    const indexHtml = readFileSync(indexFile, "utf8");
    app.use("/assets/*", serveStatic({ root: opts.staticDir }));
    app.use("/favicon.svg", serveStatic({ root: opts.staticDir }));
    app.get("*", (c) => c.html(indexHtml, 200, { "Referrer-Policy": "no-referrer" }));
  }

  return app;
}

export function eventUrl(base: string, uid: string): string {
  return `${base}/event/${encodeURIComponent(uid)}`;
}
