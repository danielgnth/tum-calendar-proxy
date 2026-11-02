// Title and location cleanup, ported from TUM-Dev/CalendarProxy (internal/app.go).

import type { RoomLink } from "../shared/types.ts";
import buildings from "./data/buildings.json" with { type: "json" };
import courses from "./data/courses.json" with { type: "json" };

const buildingAddresses: Record<string, string> = buildings;

// Longest keys first (then alphabetically) so "Zentralübungen" wins over "Übungen".
const courseReplacements = Object.entries(courses as Record<string, string>).sort(
  ([keyA, valueA], [keyB, valueB]) =>
    keyB.length - keyA.length || keyA.localeCompare(keyB) || valueA.localeCompare(valueB),
);

// Course tags like "(IN0001)", "[MA2012]" or "(IN0012, IN2106)" and everything after them.
const reTag = / ?[[(](ED|MW|SOM|CIT|MA|IN|WI|WIB)[0-9]+((_|-|, ?)[a-zA-Z0-9]+)*[\])].*/;
// Location and teacher in language course titles.
const reLangLocation = / ?(München|Garching|Weihenstephan).+/;
// Odd leading numbers like "0000002467 " in "0000002467 Semantik".
const reLeadingNumbers = /^0\d+ /;
// Event type abbreviations and filler words that carry no information in a title.
const reUnneeded = /(\(Limited places\)|\(Online\)|\bStandardgruppe\b|\b(PR|VO|FA|VI|TT|UE|SE)\b)/g;

// "MW 1801, Ernst-Schmidt-Hörsaal (5508.02.801)" -> building 5508
const reRoom = /^(.*?),.*?(\d{4})\.(?:\d\d|EG|UG|DG|Z\d|U\d)\.\d+/;
// Room ids like (5612.03.017), (5612.EG.017), (5612.EG.010B)
const reRoomId = /\((\d{4}\.[a-zA-Z0-9]{2}\.\d{3}[A-Z]?)\)/g;

/** The key a course is grouped by: the TUMonline title, trimmed. */
export function courseKey(summary: string): string {
  let s = summary.trim();
  if (s.endsWith(" ,")) s = s.slice(0, -2);
  return s;
}

export function shortenTitle(key: string): string {
  let s = key.replace(reTag, "").replace(reLangLocation, "").replace(reUnneeded, "");
  s = s
    .replace(/\s*,\s*$/, "")
    .replace(/\s\s+/g, " ")
    .trim();
  s = s.replace(reLeadingNumbers, "");
  for (const [from, to] of courseReplacements) s = s.replaceAll(from, to);
  return s.trim() || key;
}

export interface LocationInfo {
  /** Street address if the building is known, otherwise the original location. */
  location: string;
  /** Whether the location was replaced by a building address. */
  replaced: boolean;
  rooms: RoomLink[];
}

export function resolveLocation(location: string): LocationInfo {
  const rooms = [...location.matchAll(reRoomId)].map(([, id]) => ({
    id,
    url: `https://nav.tum.de/room/${id}`,
  }));
  const building = reRoom.exec(location)?.[2];
  const address = building ? buildingAddresses[building] : undefined;
  return { location: address ?? location, replaced: address !== undefined, rooms };
}
