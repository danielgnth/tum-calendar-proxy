import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveLocation, shortenTitle } from "../src/server/clean.ts";
import { processCalendar } from "../src/server/pipeline.ts";
import { applyPatch, emptyConfig } from "../src/server/store.ts";
import type { FeedConfig } from "../src/shared/types.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const ctx = { eventUrl: (uid: string) => `https://proxy.test/event/${encodeURIComponent(uid)}` };
const ERA = "Einführung in die Rechnerarchitektur (IN0004) VO, Standardgruppe";

// Undo RFC 5545 line folding so assertions can match long values.
function run(name: string, config: FeedConfig = emptyConfig()) {
  const result = processCalendar(fixture(name), config, ctx);
  return { ...result, ics: result.ics.replaceAll("\r\n ", "") };
}

function vevents(ics: string) {
  return ics.split("BEGIN:VEVENT").slice(1);
}

describe("title shortening", () => {
  it("shortens known course names", () => {
    expect(run("nameshortening.ics").events[0].title).toBe("ERA");
    expect(shortenTitle(ERA)).toBe("ERA");
  });

  it("only removes type abbreviations as whole words", () => {
    expect(shortenTitle("PROJECT SEminar VO")).toBe("PROJECT SEminar");
  });

  it("keeps words separated when collapsing whitespace", () => {
    expect(shortenTitle("Foo   Bar")).toBe("Foo Bar");
  });

  it("strips tags that list several course codes", () => {
    expect(shortenTitle("Practical Course: Open Source Lab (IN0012, IN2106, IN4308) PR,")).toBe(
      "Practical Course: Open Source Lab",
    );
  });
});

describe("locations", () => {
  it("replaces rooms with building addresses and adds nav.tum links", () => {
    const { events, ics } = run("location.ics");
    expect(events[0].location).toBe("Boltzmannstr. 15, 85748 Garching b. München");
    expect(events[0].rooms.map((r) => r.url)).toEqual(["https://nav.tum.de/room/5508.02.801"]);
    expect(ics).toContain("https://nav.tum.de/room/5508.02.801");
  });

  it("handles several rooms in one location", () => {
    const info = resolveLocation("RoomA, DescA (5508.01.001), RoomB, DescB (5612.01.001)");
    expect(info.location).toBe("Boltzmannstr. 15, 85748 Garching b. München");
    expect(info.rooms.map((r) => r.id)).toEqual(["5508.01.001", "5612.01.001"]);
  });

  it("can turn nav.tum links off", () => {
    const config = applyPatch(emptyConfig(), { options: { navLinks: false } });
    expect(run("location.ics", config).ics).not.toContain("nav.tum.de");
  });
});

describe("deduplication", () => {
  it("merges events with the same title and start and lists the other rooms", () => {
    const { events, ics } = run("duplication.ics");
    expect(events).toHaveLength(1);
    expect(events[0].mergedUids).toEqual(["889528865@tum.de"]);
    expect(vevents(ics)).toHaveLength(1);
    expect(ics).toContain("Additional rooms:\\nMI HS 1");
  });
});

describe("hiding", () => {
  it("hides a course by its original title (the upstream bug)", () => {
    const config = applyPatch(emptyConfig(), { courses: { [ERA]: { hidden: true } } });
    const { events, courses, ics } = run("coursefiltering.ics", config);
    expect(vevents(ics)).toHaveLength(1);
    expect(events.find((e) => e.courseKey === ERA)?.hiddenBy).toBe("course");
    expect(courses.find((c) => c.key === ERA)?.hidden).toBe(true);
  });

  it("matches course keys that TUMonline ends with ' ,'", () => {
    const config = applyPatch(emptyConfig(), { courses: { "Course With Suffix": { hidden: true } } });
    expect(vevents(run("coursefiltering_cleanedsummary.ics", config).ics)).toHaveLength(0);
  });

  it("hides a single event by UID", () => {
    const all = run("timeadjustment.ics");
    const target = all.events[1];
    const config = applyPatch(emptyConfig(), { events: { [target.uid]: { hidden: true } } });
    const { events, ics } = run("timeadjustment.ics", config);
    expect(vevents(ics)).toHaveLength(all.events.length - 1);
    expect(ics).not.toContain(`UID:${target.uid}`);
    expect(events.find((e) => e.uid === target.uid)?.hiddenBy).toBe("event");
  });

  it("falls back to course + start time when the UID changed", () => {
    const all = run("timeadjustment.ics");
    const target = all.events[0];
    const config = applyPatch(emptyConfig(), {
      events: { "old-uid@tum.de": { hidden: true, fallbackKey: target.fallbackKey } },
    });
    expect(run("timeadjustment.ics", config).events.find((e) => e.uid === target.uid)?.hiddenBy).toBe("event");
  });

  it("hides a whole series", () => {
    const { events } = run("duplication.ics");
    const config = applyPatch(emptyConfig(), { series: { "528560": { hidden: true } } });
    const result = run("duplication.ics", config);
    // the other room's series is still shown, now as its own event
    expect(result.events.filter((e) => !e.hiddenBy).map((e) => e.seriesId)).toEqual(["532235"]);
    expect(events[0].seriesId).toBe("528560");
  });
});

describe("renaming, notes and links", () => {
  it("uses the custom name, adds the note and the event page link", () => {
    const uid = "889438018@tum.de";
    const config = applyPatch(emptyConfig(), {
      courses: { [ERA]: { name: "Rechnerarchitektur" } },
      events: { [uid]: { note: "Bring laptop" } },
    });
    const { events, ics } = run("location.ics", config);
    expect(events[0].title).toBe("Rechnerarchitektur");
    expect(ics).toContain("SUMMARY:Rechnerarchitektur");
    expect(ics).toContain("📝 Bring laptop");
    expect(ics).toContain(`URL:https://proxy.test/event/889438018%40tum.de`);
  });

  it("writes RFC 5545 CRLF line endings only", () => {
    const { ics } = run("duplication.ics");
    expect(ics).toContain("\r\n");
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });
});

describe("config patches", () => {
  it("removes entries that no longer change anything", () => {
    let config = applyPatch(emptyConfig(), { courses: { A: { hidden: true, name: "a" } } });
    config = applyPatch(config, { courses: { A: { hidden: false } } });
    expect(config.courses).toEqual({ A: { name: "a" } });
    config = applyPatch(config, { courses: { A: { name: "" } } });
    expect(config.courses).toEqual({});
  });
});
