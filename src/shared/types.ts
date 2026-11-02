// Types shared between the server and the web UI.

export interface FeedOptions {
  /** Add nav.tum.de room links to the event description. */
  navLinks: boolean;
  /** Add a link to this proxy's event page (hide / comment) to every event. */
  manageLinks: boolean;
  /** Drop events that TUMonline marks as cancelled instead of showing them as cancelled. */
  hideCancelled: boolean;
  /** Keep the original TUMonline title in the event description. */
  originalTitleInDescription: boolean;
}

export interface CourseRule {
  hidden?: boolean;
  /** Custom title; overrides the automatic shortening. */
  name?: string;
}

export interface SeriesRule {
  hidden?: boolean;
}

export interface EventRule {
  hidden?: boolean;
  note?: string;
  /** courseKey|start, used when TUMonline changes the UID of an event. */
  fallbackKey?: string;
}

export interface FeedConfig {
  version: 1;
  options: FeedOptions;
  /** Keyed by course key (the original TUMonline title). */
  courses: Record<string, CourseRule>;
  /** Keyed by X-CO-RECURRINGID. */
  series: Record<string, SeriesRule>;
  /** Keyed by event UID. */
  events: Record<string, EventRule>;
  updatedAt?: string;
}

/** Partial update; `null` removes an entry. */
export interface ConfigPatch {
  options?: Partial<FeedOptions>;
  courses?: Record<string, CourseRule | null>;
  series?: Record<string, SeriesRule | null>;
  events?: Record<string, EventRule | null>;
}

export type HiddenReason = "course" | "series" | "event" | "cancelled";

export interface RoomLink {
  id: string;
  url: string;
}

export interface CalendarEvent {
  uid: string;
  /** UIDs of duplicates that were merged into this event. */
  mergedUids: string[];
  courseKey: string;
  seriesId: string | null;
  fallbackKey: string;
  title: string;
  originalTitle: string;
  start: string;
  end: string | null;
  location: string;
  originalLocation: string;
  additionalLocations: string[];
  rooms: RoomLink[];
  status: string | null;
  tumUrl: string | null;
  hiddenBy: HiddenReason | null;
  note: string | null;
}

export interface SeriesSummary {
  id: string;
  count: number;
  hidden: boolean;
  firstStart: string;
  lastStart: string;
}

export interface CourseSummary {
  key: string;
  autoName: string;
  name: string | null;
  hidden: boolean;
  count: number;
  upcoming: number;
  series: SeriesSummary[];
}

export interface CalendarView {
  calendarName: string | null;
  feedUrl: string;
  loginUrl: string;
  config: FeedConfig;
  courses: CourseSummary[];
  events: CalendarEvent[];
  fetchedAt: string;
}

export interface EventView {
  event: CalendarEvent;
  course: CourseSummary;
  config: FeedConfig;
}

export const DEFAULT_OPTIONS: FeedOptions = {
  navLinks: true,
  manageLinks: true,
  hideCancelled: false,
  originalTitleInDescription: true,
};
