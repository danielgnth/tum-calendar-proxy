import type { CalendarEvent, HiddenReason } from "../../src/shared/types.ts";

const timeZone = "Europe/Berlin";
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" });
const longDayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" });
const dateKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });

export const formatDay = (iso: string) => dayFmt.format(new Date(iso));
export const formatLongDay = (iso: string) => longDayFmt.format(new Date(iso));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
export const dayKey = (iso: string) => dateKeyFmt.format(new Date(iso));

export function formatTimeRange(e: Pick<CalendarEvent, "start" | "end">): string {
  return e.end ? `${formatTime(e.start)}–${formatTime(e.end)}` : formatTime(e.start);
}

/** "Mon 10:00–12:00" for the first event of a series. */
export function seriesLabel(e: Pick<CalendarEvent, "start" | "end">): string {
  return `${weekdayFmt.format(new Date(e.start))} ${formatTimeRange(e)}`;
}

export const hiddenLabel: Record<HiddenReason, string> = {
  course: "course hidden",
  series: "series hidden",
  event: "hidden",
  cancelled: "cancelled",
};

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}
