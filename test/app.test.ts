import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDENTIALS_HEADER, createApp } from "../src/server/app.ts";
import { credentialsHash, parseCredentials, redact } from "../src/server/credentials.ts";
import { ConfigStore } from "../src/server/store.ts";
import type { CalendarSource } from "../src/server/tumonline.ts";
import { UpstreamError } from "../src/server/tumonline.ts";
import type { CalendarView, EventView } from "../src/shared/types.ts";

const ics = readFileSync(new URL("./fixtures/timeadjustment.ics", import.meta.url), "utf8");
const ID = "ABCDEF123456";
const TOKEN = "0123456789ABCDEF0123456789ABCDEF";
const query = `pStud=${ID}&pToken=${TOKEN}`;

const source: CalendarSource = async (c) => {
  if (c.token !== TOKEN) throw new UpstreamError("TUMonline did not return a calendar.", 401);
  return { ics, fetchedAt: new Date() };
};

function setup(openRegistration = true) {
  const dataDir = mkdtempSync(join(tmpdir(), "tumcal-"));
  const app = createApp({
    source,
    store: new ConfigStore(dataDir),
    publicUrl: "https://proxy.test",
    openRegistration,
    log: () => {},
  });
  const api = (path: string, init: RequestInit = {}) =>
    app.request(`/api${path}`, {
      ...init,
      headers: { [CREDENTIALS_HEADER]: query, "Content-Type": "application/json", ...init.headers },
    });
  return { app, api, dataDir };
}

describe("credentials", () => {
  it("parses TUMonline, cal.tum.app and own links", () => {
    for (const url of [
      `https://campus.tum.de/tumonlinej/de/termin/ical?${query}`,
      `https://cal.tum.app/?${query}&hide=foo`,
      `webcal://proxy.test/cal.ics?${query}`,
    ]) {
      expect(parseCredentials(url)).toEqual({ kind: "pStud", id: ID, token: TOKEN });
    }
    expect(parseCredentials("https://example.com/?pStud=1")).toBeNull();
  });

  it("redacts tokens in logs", () => {
    expect(redact(`/cal.ics?${query}`)).toBe("/cal.ics?pStud=ABCD…&pToken=0123…");
  });
});

describe("api", () => {
  it("logs in and stores only a hash, never the token", async () => {
    const { app, dataDir } = setup();
    const res = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ url: `https://campus.tum.de/tumonlinej/de/termin/ical?${query}` }),
    });
    expect(res.status).toBe(200);
    const files = readdirSync(join(dataDir, "feeds"));
    const hash = credentialsHash({ kind: "pStud", id: ID, token: TOKEN });
    expect(files).toEqual([`${hash}.json`]);
    const stored = readFileSync(join(dataDir, "feeds", files[0]), "utf8");
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain(ID);
  });

  it("rejects a wrong token at login", async () => {
    const { app } = setup();
    const res = await app.request("/api/login", {
      method: "POST",
      body: JSON.stringify({ url: `pStud=${ID}&pToken=WRONG` }),
    });
    expect(res.status).toBe(401);
  });

  it("requires credentials for the API", async () => {
    const { app } = setup();
    expect((await app.request("/api/calendar")).status).toBe(401);
  });

  it("applies changes to the feed", async () => {
    const { app, api } = setup();
    const view = (await (await api("/calendar")).json()) as CalendarView;
    expect(view.feedUrl).toBe(`https://proxy.test/cal.ics?${query}`);
    const [first] = view.events;

    const patched = await api("/config", {
      method: "PATCH",
      body: JSON.stringify({ events: { [first.uid]: { hidden: true, note: "skip" } } }),
    });
    expect(patched.status).toBe(200);
    const after = (await patched.json()) as CalendarView;
    expect(after.config.events[first.uid]).toEqual({ hidden: true, note: "skip", fallbackKey: first.fallbackKey });

    const feed = await (await app.request(`/cal.ics?${query}`)).text();
    expect(feed).not.toContain(`UID:${first.uid}`);

    const event = (await (await api(`/events/${encodeURIComponent(first.uid)}`)).json()) as EventView;
    expect(event.event.hiddenBy).toBe("event");
  });

  it("rejects malformed patches", async () => {
    const { api } = setup();
    const res = await api("/config", { method: "PATCH", body: JSON.stringify({ courses: { A: { evil: 1 } } }) });
    expect(res.status).toBe(400);
  });

  it("serves only registered calendars when registration is closed", async () => {
    const { app } = setup(false);
    expect((await app.request(`/cal.ics?${query}`)).status).toBe(403);
  });
});
