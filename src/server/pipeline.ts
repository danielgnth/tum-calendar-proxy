import ICAL from "ical.js";
import type {
  CalendarEvent,
  CourseSummary,
  EventRule,
  FeedConfig,
  HiddenReason,
  SeriesSummary,
} from "../shared/types.ts";
import { resolveLocation, shortenTitle, courseKey as toCourseKey } from "./clean.ts";

export interface ProcessContext {
  /** Absolute URL of this proxy's page for an event. */
  eventUrl: (uid: string) => string;
  now?: Date;
}

export interface ProcessResult {
  ics: string;
  calendarName: string | null;
  events: CalendarEvent[];
  courses: CourseSummary[];
}

interface SourceEvent {
  comp: ICAL.Component;
  uid: string;
  courseKey: string;
  seriesId: string | null;
  start: string;
  end: string | null;
  location: string;
  description: string;
  status: string | null;
  tumUrl: string | null;
}

function text(comp: ICAL.Component, name: string): string {
  const value = comp.getFirstPropertyValue(name);
  return value == null ? "" : String(value).trim();
}

function isoTime(comp: ICAL.Component, name: string): string | null {
  const value = comp.getFirstPropertyValue(name);
  return value instanceof ICAL.Time ? value.toJSDate().toISOString() : null;
}

function readEvent(comp: ICAL.Component): SourceEvent {
  const key = toCourseKey(text(comp, "summary"));
  const start = isoTime(comp, "dtstart") ?? "";
  return {
    comp,
    uid: text(comp, "uid") || `${key}|${start}`,
    courseKey: key,
    seriesId: text(comp, "x-co-recurringid") || null,
    start,
    end: isoTime(comp, "dtend"),
    location: text(comp, "location"),
    description: text(comp, "description"),
    status: text(comp, "status").toUpperCase() || null,
    tumUrl: text(comp, "url") || null,
  };
}

export function fallbackKey(courseKey: string, start: string): string {
  return `${courseKey}|${start}`;
}

/** The title an event gets in the output: custom name, automatic shortening, or the original. */
export function displayName(config: FeedConfig, key: string): string {
  return config.courses[key]?.name?.trim() || shortenTitle(key);
}

/**
 * Applies the feed configuration to a TUMonline calendar:
 * hide courses/series/cancelled events, merge duplicates, hide single events,
 * rename, resolve locations and add links.
 */
export function processCalendar(raw: string, config: FeedConfig, ctx: ProcessContext): ProcessResult {
  const cal = new ICAL.Component(ICAL.parse(raw));
  const source = cal.getAllSubcomponents("vevent").map(readEvent);
  const { options } = config;

  const preHidden = (e: SourceEvent): HiddenReason | null => {
    if (config.courses[e.courseKey]?.hidden) return "course";
    if (e.seriesId && config.series[e.seriesId]?.hidden) return "series";
    if (options.hideCancelled && e.status === "CANCELLED") return "cancelled";
    return null;
  };

  // TUMonline exports an event once per room, so merge events with the same title and
  // start time. Events hidden for different reasons are never merged with each other.
  const groups = new Map<string, { hiddenBy: HiddenReason | null; members: SourceEvent[] }>();
  for (const e of source) {
    const hiddenBy = preHidden(e);
    const key = `${hiddenBy ?? ""}|${e.courseKey}|${e.start}`;
    const group = groups.get(key);
    if (group) group.members.push(e);
    else groups.set(key, { hiddenBy, members: [e] });
  }

  const rulesByFallback = new Map<string, EventRule>();
  for (const rule of Object.values(config.events)) {
    if (rule.fallbackKey) rulesByFallback.set(rule.fallbackKey, rule);
  }

  const events: CalendarEvent[] = [];
  const keep = new Set<ICAL.Component>();

  for (const { hiddenBy: preReason, members } of groups.values()) {
    const [primary] = members;
    const fbKey = fallbackKey(primary.courseKey, primary.start);
    const rule = members.map((m) => config.events[m.uid]).find(Boolean) ?? rulesByFallback.get(fbKey);
    const hiddenBy = preReason ?? (rule?.hidden ? "event" : null);

    const locations = [...new Set(members.map((m) => m.location).filter(Boolean))];
    const additionalLocations = locations.filter((l) => l !== primary.location);
    const resolved = resolveLocation(primary.location);
    const note = rule?.note?.trim() || null;

    const event: CalendarEvent = {
      uid: primary.uid,
      mergedUids: members.slice(1).map((m) => m.uid),
      courseKey: primary.courseKey,
      seriesId: primary.seriesId,
      fallbackKey: fbKey,
      title: displayName(config, primary.courseKey),
      originalTitle: primary.courseKey,
      start: primary.start,
      end: primary.end,
      location: resolved.location,
      originalLocation: primary.location,
      additionalLocations,
      rooms: resolved.rooms,
      status: primary.status,
      tumUrl: primary.tumUrl,
      hiddenBy,
      note,
    };
    events.push(event);
    if (hiddenBy) continue;

    const lines: string[] = [];
    if (note) lines.push(`📝 ${note}`, "");
    if (additionalLocations.length) lines.push("Additional rooms:", ...additionalLocations, "");
    if (options.navLinks) lines.push(...resolved.rooms.map((r) => r.url));
    if (resolved.replaced) lines.push(primary.location);
    if (options.originalTitleInDescription) lines.push(primary.courseKey);
    if (primary.description) lines.push(primary.description);

    const comp = primary.comp;
    comp.updatePropertyWithValue("summary", event.title);
    if (resolved.replaced) comp.updatePropertyWithValue("location", resolved.location);
    if (options.manageLinks) {
      const url = ctx.eventUrl(event.uid);
      if (primary.tumUrl) lines.push("", `TUMonline: ${primary.tumUrl}`);
      lines.push("", `Hide or comment: ${url}`);
      comp.updatePropertyWithValue("url", url);
    }
    comp.updatePropertyWithValue("description", lines.join("\n").trim());
    keep.add(comp);
  }

  for (const e of source) if (!keep.has(e.comp)) cal.removeSubcomponent(e.comp);

  events.sort((a, b) => a.start.localeCompare(b.start));
  return {
    ics: cal.toString(),
    calendarName: text(cal, "x-wr-calname") || null,
    events,
    courses: summarizeCourses(events, config, ctx.now ?? new Date()),
  };
}

function summarizeCourses(events: CalendarEvent[], config: FeedConfig, now: Date): CourseSummary[] {
  const nowIso = now.toISOString();
  const courses = new Map<string, CourseSummary>();
  const series = new Map<string, SeriesSummary>();

  for (const e of events) {
    let course = courses.get(e.courseKey);
    if (!course) {
      course = {
        key: e.courseKey,
        autoName: shortenTitle(e.courseKey),
        name: config.courses[e.courseKey]?.name?.trim() || null,
        hidden: Boolean(config.courses[e.courseKey]?.hidden),
        count: 0,
        upcoming: 0,
        series: [],
      };
      courses.set(e.courseKey, course);
    }
    course.count++;
    if (e.start >= nowIso) course.upcoming++;

    if (!e.seriesId) continue;
    const seriesKey = `${e.courseKey}\u0000${e.seriesId}`;
    let s = series.get(seriesKey);
    if (!s) {
      s = {
        id: e.seriesId,
        count: 0,
        hidden: Boolean(config.series[e.seriesId]?.hidden),
        firstStart: e.start,
        lastStart: e.start,
      };
      series.set(seriesKey, s);
      course.series.push(s);
    }
    s.count++;
    if (e.start > s.lastStart) s.lastStart = e.start;
  }

  return [...courses.values()].sort((a, b) => (a.name ?? a.autoName).localeCompare(b.name ?? b.autoName, "de"));
}
