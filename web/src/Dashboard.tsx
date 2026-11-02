import { useEffect, useId, useMemo, useState } from "react";
import type { CalendarEvent, CalendarView, ConfigPatch, CourseSummary, FeedOptions } from "../../src/shared/types.ts";
import { copyText, dayKey, formatDay, formatTimeRange, hiddenLabel, seriesLabel } from "./format.ts";
import { Link, Switch, useCalendar } from "./lib.tsx";

type Tab = "courses" | "events" | "options";
type Patch = (patch: ConfigPatch) => void;

function readTab(): Tab | null {
  try {
    return sessionStorage.getItem("tumcal.tab") as Tab | null;
  } catch {
    return null;
  }
}

export function Dashboard() {
  const { view, error, busy, refresh, patch } = useCalendar();
  const [tab, setTab] = useState<Tab>(() => readTab() ?? "courses");
  useEffect(() => {
    try {
      sessionStorage.setItem("tumcal.tab", tab);
    } catch {}
  }, [tab]);

  if (!view) {
    return (
      <main>{error ? <p className="error">{error}</p> : <p className="muted center">Loading your calendar…</p>}</main>
    );
  }

  return (
    <main>
      <SubscribeCard view={view} />
      <nav className="tabs" aria-label="Sections">
        {(["courses", "events", "options"] as const).map((t) => (
          <button type="button" key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>
            {t === "courses" ? `Courses (${view.courses.length})` : t === "events" ? "Events" : "Options"}
          </button>
        ))}
        <span className="spacer" />
        <span className="status muted small" aria-live="polite">
          {busy ? "Saving…" : error ? <span className="error">{error}</span> : null}
        </span>
        <button
          type="button"
          className="ghost small"
          onClick={refresh}
          disabled={busy}
          title={`Fetched ${new Date(view.fetchedAt).toLocaleTimeString()}`}
        >
          ↻ Reload from TUMonline
        </button>
      </nav>
      {tab === "courses" && <CoursesTab view={view} patch={patch} />}
      {tab === "events" && <EventsTab view={view} patch={patch} />}
      {tab === "options" && <OptionsTab options={view.config.options} patch={patch} />}
    </main>
  );
}

// ---- subscribe ---------------------------------------------------------------

function CopyField(props: { label: string; value: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const id = useId();
  return (
    <div className="copyfield">
      <label htmlFor={id}>{props.label}</label>
      <div className="row">
        <input id={id} readOnly value={props.value} onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          onClick={async () => {
            await copyText(props.value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="muted small">{props.hint}</p>
    </div>
  );
}

function SubscribeCard({ view }: { view: CalendarView }) {
  const webcal = view.feedUrl.replace(/^https?:/, "webcal:");
  const visible = view.events.filter((e) => !e.hiddenBy).length;
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{view.calendarName ?? "Your calendar"}</h2>
          <p className="muted small">
            {visible} of {view.events.length} events shown · {view.courses.filter((c) => c.hidden).length} courses
            hidden
          </p>
        </div>
        <a className="button primary" href={webcal}>
          Subscribe
        </a>
      </div>
      <CopyField
        label="Calendar feed"
        value={view.feedUrl}
        hint="Subscribe to this URL in your calendar app (iOS: Settings → Calendar → Accounts → Add Subscribed Calendar). Changes appear after the app's next refresh."
      />
      <CopyField
        label="Login link"
        value={view.loginUrl}
        hint="Bookmark this to open the settings on another device. Both links contain your TUMonline token – keep them private."
      />
    </section>
  );
}

// ---- courses -----------------------------------------------------------------

function NameInput(props: { course: CourseSummary; patch: Patch }) {
  const { course } = props;
  const [value, setValue] = useState(course.name ?? "");
  useEffect(() => setValue(course.name ?? ""), [course.name]);
  const commit = () => {
    if (value.trim() !== (course.name ?? "")) props.patch({ courses: { [course.key]: { name: value.trim() } } });
  };
  return (
    <input
      className="name-input"
      value={value}
      placeholder={course.autoName}
      aria-label={`Name for ${course.key}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

function CoursesTab({ view, patch }: { view: CalendarView; patch: Patch }) {
  const [query, setQuery] = useState("");
  const firstOfSeries = useMemo(() => {
    const map = new Map<string, CalendarEvent>();
    for (const e of view.events) if (e.seriesId && !map.has(e.seriesId)) map.set(e.seriesId, e);
    return map;
  }, [view.events]);

  const q = query.trim().toLowerCase();
  const courses = view.courses.filter(
    (c) => !q || [c.key, c.autoName, c.name ?? ""].some((s) => s.toLowerCase().includes(q)),
  );

  return (
    <section>
      <p className="muted small intro">
        Switch off courses you don't want to see, and give courses your own names. Leave a name empty to use the
        automatic short name shown in grey.
      </p>
      <input
        className="search"
        type="search"
        placeholder="Search courses"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="course-list">
        {courses.map((course) => (
          <li key={course.key} className={`card course ${course.hidden ? "is-hidden" : ""}`}>
            <div className="course-main">
              <Switch
                checked={!course.hidden}
                label={course.hidden ? "Show course" : "Hide course"}
                onChange={(on) => patch({ courses: { [course.key]: { hidden: !on } } })}
              />
              <div className="course-text">
                <NameInput course={course} patch={patch} />
                <div className="muted small original" title={course.key}>
                  {course.key}
                </div>
              </div>
              <div className="muted small count">
                {course.upcoming} upcoming
                <br />
                {course.count} total
              </div>
            </div>
            {course.series.length > 1 && !course.hidden && (
              <details className="series">
                <summary className="small">{course.series.length} series (groups / time slots)</summary>
                <ul>
                  {course.series.map((s) => {
                    const first = firstOfSeries.get(s.id);
                    return (
                      <li key={s.id}>
                        <Switch
                          checked={!s.hidden}
                          label={s.hidden ? "Show series" : "Hide series"}
                          onChange={(on) => patch({ series: { [s.id]: { hidden: !on } } })}
                        />
                        <span>
                          {first ? seriesLabel(first) : s.id}
                          <span className="muted small">
                            {" "}
                            · {s.count}× · {first?.originalLocation || "no room"}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
      {courses.length === 0 && <p className="muted center">No courses found.</p>}
    </section>
  );
}

// ---- events ------------------------------------------------------------------

function EventsTab({ view, patch }: { view: CalendarView; patch: Patch }) {
  const [range, setRange] = useState<"upcoming" | "past" | "all">("upcoming");
  const [showHidden, setShowHidden] = useState(true);
  const [query, setQuery] = useState("");

  const days = useMemo(() => {
    const now = new Date().toISOString();
    const q = query.trim().toLowerCase();
    const list = view.events.filter(
      (e) =>
        (range === "all" || (range === "upcoming" ? (e.end ?? e.start) >= now : e.start < now)) &&
        (showHidden || !e.hiddenBy) &&
        (!q || [e.title, e.originalTitle, e.location, e.note ?? ""].some((s) => s.toLowerCase().includes(q))),
    );
    if (range === "past") list.reverse();
    const grouped = new Map<string, CalendarEvent[]>();
    for (const e of list) {
      const key = dayKey(e.start);
      grouped.set(key, [...(grouped.get(key) ?? []), e]);
    }
    return [...grouped.values()];
  }, [view.events, range, showHidden, query]);

  return (
    <section>
      <div className="filters">
        <div className="segmented">
          {(["upcoming", "past", "all"] as const).map((r) => (
            <button type="button" key={r} className={r === range ? "active" : ""} onClick={() => setRange(r)}>
              {r[0].toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
        <label className="check small">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden
        </label>
        <input
          className="search"
          type="search"
          placeholder="Search events"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {days.map((events) => (
        <div key={events[0].uid} className="day">
          <h3>{formatDay(events[0].start)}</h3>
          <ul className="card event-list">
            {events.map((e) => (
              <EventRow key={e.uid} event={e} patch={patch} />
            ))}
          </ul>
        </div>
      ))}
      {days.length === 0 && <p className="muted center">No events.</p>}
    </section>
  );
}

function EventRow({ event: e, patch }: { event: CalendarEvent; patch: Patch }) {
  const hiddenByOther = e.hiddenBy && e.hiddenBy !== "event";
  return (
    <li className={`event ${e.hiddenBy ? "is-hidden" : ""} ${e.status === "CANCELLED" ? "is-cancelled" : ""}`}>
      <span className="time small">{formatTimeRange(e)}</span>
      <Link to={`/event/${encodeURIComponent(e.uid)}`} className="event-text">
        <span className="title">
          {e.title}
          {e.status === "CANCELLED" && <span className="badge warn">cancelled</span>}
          {e.hiddenBy && <span className="badge">{hiddenLabel[e.hiddenBy]}</span>}
          {e.note && (
            <span className="badge note" title={e.note}>
              📝 note
            </span>
          )}
        </span>
        <span className="muted small">{e.originalLocation || e.location}</span>
      </Link>
      {!hiddenByOther && (
        <button type="button" className="small" onClick={() => patch({ events: { [e.uid]: { hidden: !e.hiddenBy } } })}>
          {e.hiddenBy ? "Show" : "Hide"}
        </button>
      )}
    </li>
  );
}

// ---- options -----------------------------------------------------------------

const optionText: Record<keyof FeedOptions, [string, string]> = {
  manageLinks: [
    "Hide / comment link in events",
    "Adds a link to every event that opens it here, so you can hide it or add a note right from your calendar app.",
  ],
  navLinks: ["NavigaTUM room links", "Adds nav.tum.de links for the event's rooms to the description."],
  originalTitleInDescription: [
    "Original title in description",
    "Keeps the full TUMonline course title in the description.",
  ],
  hideCancelled: [
    "Remove cancelled events",
    "By default cancelled events stay in the calendar, marked as cancelled. Turn this on to drop them entirely.",
  ],
};

function OptionsTab({ options, patch }: { options: FeedOptions; patch: Patch }) {
  return (
    <section className="card options">
      {(Object.keys(optionText) as (keyof FeedOptions)[]).map((key) => (
        <div key={key} className="option">
          <div>
            <div>{optionText[key][0]}</div>
            <p className="muted small">{optionText[key][1]}</p>
          </div>
          <Switch
            checked={options[key]}
            label={optionText[key][0]}
            onChange={(on) => patch({ options: { [key]: on } })}
          />
        </div>
      ))}
    </section>
  );
}
