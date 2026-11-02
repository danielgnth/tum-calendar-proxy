import { useCallback, useEffect, useState } from "react";
import type { ConfigPatch, EventView } from "../../src/shared/types.ts";
import { api } from "./api.ts";
import { formatLongDay, formatTimeRange, hiddenLabel, seriesLabel } from "./format.ts";
import { Link } from "./lib.tsx";

/** Opened from the link in a calendar event: hide it, its series or course, or add a note. */
export function EventPage({ uid }: { uid: string }) {
  const [data, setData] = useState<EventView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    const next = await api.event(uid);
    setData(next);
    setNote(next.event.note ?? "");
    setName(next.course.name ?? "");
  }, [uid]);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  async function save(patch: ConfigPatch) {
    setBusy(true);
    try {
      await api.patch(patch);
      await load();
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <main className="narrow">
        <Link to="/" className="back">
          ← All courses and events
        </Link>
        {error ? <p className="error">{error}</p> : <p className="muted center">Loading event…</p>}
      </main>
    );
  }

  const { event: e, course, config } = data;
  // The rule may be stored under a merged duplicate's UID or an older UID (matched by course + start).
  const ruleKey =
    [e.uid, ...e.mergedUids].find((u) => config.events[u]) ??
    Object.entries(config.events).find(([, r]) => r.fallbackKey === e.fallbackKey)?.[0] ??
    e.uid;
  const eventRule = config.events[ruleKey];
  const series = course.series.find((s) => s.id === e.seriesId);
  const noteChanged = note.trim() !== (e.note ?? "");
  const nameChanged = name.trim() !== (course.name ?? "");

  return (
    <main className="narrow">
      <Link to="/" className="back">
        ← All courses and events
      </Link>

      <section className={`card event-detail ${e.hiddenBy ? "is-hidden" : ""}`}>
        <div className="badges">
          {e.hiddenBy ? (
            <span className="badge">
              {e.hiddenBy === "event" ? "hidden" : hiddenLabel[e.hiddenBy]} · not in your calendar
            </span>
          ) : (
            <span className="badge ok">shown in your calendar</span>
          )}
          {e.status === "CANCELLED" && <span className="badge warn">cancelled by TUMonline</span>}
        </div>
        <h1>{e.title}</h1>
        <p className="muted small">{e.originalTitle}</p>
        <dl>
          <dt>When</dt>
          <dd>
            {formatLongDay(e.start)}, {formatTimeRange(e)}
          </dd>
          {(e.originalLocation || e.location) && (
            <>
              <dt>Where</dt>
              <dd>
                {e.originalLocation}
                {e.location !== e.originalLocation && <div className="muted small">{e.location}</div>}
                {e.additionalLocations.length > 0 && (
                  <div className="muted small">Also: {e.additionalLocations.join(" · ")}</div>
                )}
                {e.rooms.length > 0 && (
                  <div className="links">
                    {e.rooms.map((r) => (
                      <a key={r.id} className="button small" href={r.url} target="_blank" rel="noreferrer">
                        {r.id} on NavigaTUM ↗
                      </a>
                    ))}
                  </div>
                )}
              </dd>
            </>
          )}
          {e.tumUrl && (
            <>
              <dt>Course</dt>
              <dd>
                <a href={e.tumUrl} target="_blank" rel="noreferrer">
                  Open in TUMonline ↗
                </a>
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className="card actions">
        <h2>Hide</h2>
        <ActionRow
          title="This event"
          detail="Only this one date."
          active={Boolean(eventRule?.hidden)}
          disabled={busy}
          onToggle={(hidden) => save({ events: { [ruleKey]: { hidden } } })}
        />
        {series && course.series.length > 1 && (
          <ActionRow
            title="This series"
            detail={`All ${series.count} events of this group / time slot (${seriesLabel(e)}).`}
            active={series.hidden}
            disabled={busy}
            onToggle={(hidden) => save({ series: { [series.id]: { hidden } } })}
          />
        )}
        <ActionRow
          title="The whole course"
          detail={`All ${course.count} events of “${course.name ?? course.autoName}”.`}
          active={course.hidden}
          disabled={busy}
          onToggle={(hidden) => save({ courses: { [course.key]: { hidden } } })}
        />
      </section>

      <section className="card">
        <h2>Note</h2>
        <p className="muted small">Shown at the top of the event's description in your calendar app.</p>
        <textarea
          rows={3}
          value={note}
          placeholder="e.g. Bring laptop, homework due"
          onChange={(ev) => setNote(ev.target.value)}
        />
        <div className="row end">
          {e.note && (
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => save({ events: { [ruleKey]: { note: "" } } })}
            >
              Remove
            </button>
          )}
          <button
            type="button"
            className="primary"
            disabled={busy || !noteChanged}
            onClick={() => save({ events: { [ruleKey]: { note: note.trim() } } })}
          >
            Save note
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Course name</h2>
        <p className="muted small">Used for every event of this course. Leave empty for “{course.autoName}”.</p>
        <div className="row">
          <input value={name} placeholder={course.autoName} onChange={(ev) => setName(ev.target.value)} />
          <button
            type="button"
            className="primary"
            disabled={busy || !nameChanged}
            onClick={() => save({ courses: { [course.key]: { name: name.trim() } } })}
          >
            Save
          </button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}
      <p className="muted small center">Changes reach your calendar app on its next refresh.</p>
    </main>
  );
}

function ActionRow(props: {
  title: string;
  detail: string;
  active: boolean;
  disabled: boolean;
  onToggle: (hidden: boolean) => void;
}) {
  return (
    <div className="action">
      <div>
        <div>{props.title}</div>
        <p className="muted small">{props.detail}</p>
      </div>
      <button
        type="button"
        className={props.active ? "" : "danger"}
        disabled={props.disabled}
        onClick={() => props.onToggle(!props.active)}
      >
        {props.active ? "Show again" : "Hide"}
      </button>
    </div>
  );
}
